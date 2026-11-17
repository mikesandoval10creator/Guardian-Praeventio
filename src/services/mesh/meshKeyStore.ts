// SPDX-License-Identifier: MIT
//
// On-device cache + provisioning for the per-project mesh HMAC signing key.
//
// The key is minted server-side and returned ONLY to authenticated project
// members (GET /api/mesh/key, gated by verifyAuth + assertProjectMember). We
// fetch it while online, import it as a non-extractable HMAC CryptoKey, and
// persist the raw bytes in IndexedDB so the device can keep signing/verifying
// mesh packets OFFLINE (tunnel, no cell signal). The raw bytes are needed in
// IDB because importKey re-creates the CryptoKey after a cold start. This
// module does not encrypt its IndexedDB record or use SQLCipher; the security
// data-flow inventory treats IndexedDB-at-rest encryption as a separate gap.
//
// Mirrors deviceKek.ts (idb store) + slm/hmac.ts (importKey raw HMAC).

import { openDB, type IDBPDatabase } from 'idb';
import type { MeshSigningKey } from './meshPacketSigner';
import { apiAuthHeader } from '../../lib/apiAuth';
import { logger } from '../../utils/logger';

const DB_NAME = 'praeventio-mesh-keys';
const STORE = 'keys';
const DB_VERSION = 1;
const MESH_KEY_BYTES = 32;
const MESH_KEY_BASE64_RE = /^[A-Za-z0-9+/]{43}=$/;

interface MeshKeyRecord {
  projectId: string;
  keyId: string;
  rawKeyB64: string;
  fetchedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
const memCache = new Map<string, MeshSigningKey>();
// Coalesce same-project requests only within the same auth header. Never let a
// caller without membership piggyback on another member's in-flight key fetch.
const provisionInFlight = new Map<string, Promise<MeshSigningKey | null>>();
const projectWriteLocks = new Map<string, Promise<void>>();

async function withProjectWriteLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  const previous = projectWriteLocks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  projectWriteLocks.set(projectId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (projectWriteLocks.get(projectId) === tail) projectWriteLocks.delete(projectId);
  }
}

function meshKeyVersion(projectId: string, keyId: string): number | null {
  const prefix = `${projectId}:v`;
  if (!keyId.startsWith(prefix)) return null;
  const version = keyId.slice(prefix.length);
  if (!/^[1-9][0-9]*$/.test(version)) return null;
  const parsed = Number(version);
  return Number.isSafeInteger(parsed) ? parsed : null;
}


function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'projectId' });
        }
      },
    });
  }
  return dbPromise;
}

function getSubtle(): SubtleCrypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.subtle ?? null;
}

function base64ToBytes(b64: string): Uint8Array {
  if (!MESH_KEY_BASE64_RE.test(b64)) {
    throw new Error('Invalid mesh signing key encoding');
  }
  const s = globalThis.atob(b64);
  if (s.length !== MESH_KEY_BYTES || globalThis.btoa(s) !== b64) {
    throw new Error('Invalid mesh signing key length or encoding');
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importHmacKey(rawKey: Uint8Array): Promise<CryptoKey | null> {
  const subtle = getSubtle();
  if (!subtle) return null;
  return subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // non-extractable
    ['sign', 'verify'],
  );
}

/**
 * Return the cached mesh signing key for a project, or null if none is
 * provisioned yet. Reads in-memory cache → IDB (cold start). Never throws.
 */
export async function getMeshSigningKey(
  projectId: string,
): Promise<MeshSigningKey | null> {
  const cached = memCache.get(projectId);
  if (cached) return cached;
  try {
    const db = await getDb();
    const rec = (await db.get(STORE, projectId)) as MeshKeyRecord | undefined;
    if (!rec) return null;

    let rawKey: Uint8Array;
    try {
      if (
        rec.projectId !== projectId ||
        typeof rec.keyId !== 'string' ||
        rec.keyId.length === 0 ||
        typeof rec.rawKeyB64 !== 'string'
      ) {
        throw new Error('Invalid mesh key record');
      }
      rawKey = base64ToBytes(rec.rawKeyB64);
    } catch {
      await db.delete(STORE, projectId);
      logger.warn('meshKeyStore: corrupt cached key removed', { projectId });
      return null;
    }

    let key: CryptoKey | null;
    try {
      key = await importHmacKey(rawKey);
    } catch {
      await db.delete(STORE, projectId);
      logger.warn('meshKeyStore: unimportable cached key removed', { projectId });
      return null;
    }
    if (!key) return null;
    const signing: MeshSigningKey = { keyId: rec.keyId, key };
    memCache.set(projectId, signing);
    return signing;
  } catch (err) {
    logger.error('meshKeyStore: load failed', err);
    return null;
  }
}

/**
 * Fetch the project mesh key from the server (must be online + authed) and
 * persist it for offline use. Idempotent; refreshes on keyId change
 * (rotation). Returns the provisioned key or null on failure. Never throws.
 */
async function fetchAndPersistMeshKey(
  projectId: string,
  auth: string,
  fetchImpl: typeof fetch,
): Promise<MeshSigningKey | null> {
  const res = await fetchImpl(
    `/api/mesh/key?projectId=${encodeURIComponent(projectId)}`,
    { headers: { Authorization: auth } },
  );
  if (!res.ok) {
    logger.warn('meshKeyStore: provision failed', { status: res.status });
    return null;
  }
  const body = (await res.json()) as { keyId?: unknown; key?: unknown };
  if (
    typeof body.keyId !== 'string' || body.keyId.length === 0 ||
    typeof body.key !== 'string'
  ) return null;

  try {
    base64ToBytes(body.key);
  } catch {
    logger.warn('meshKeyStore: provision rejected invalid key material');
    return null;
  }
  if (meshKeyVersion(projectId, body.keyId) === null) {
    logger.warn('meshKeyStore: provision rejected keyId outside project/version scope', { projectId });
    return null;
  }

  const db = await getDb();
  const incoming: MeshKeyRecord = {
    projectId,
    keyId: body.keyId,
    rawKeyB64: body.key,
    fetchedAt: new Date().toISOString(),
  };
  const selectedRecord = await withProjectWriteLock(projectId, async () => {
    // A readwrite IDB transaction serializes compare-and-write across tabs.
    // The in-memory queue also keeps this tab's cache invalidation and reload
    // in the same order as its writes.
    const tx = db.transaction(STORE, 'readwrite');
    const current = await tx.store.get(projectId) as MeshKeyRecord | undefined;
    let currentIsValid = false;
    if (
      current && current.projectId === projectId &&
      typeof current.keyId === 'string' && current.keyId.length > 0 &&
      typeof current.rawKeyB64 === 'string'
    ) {
      try {
        base64ToBytes(current.rawKeyB64);
        currentIsValid = true;
      } catch {
        currentIsValid = false;
      }
    }

    if (currentIsValid && current) {
      if (current.keyId === incoming.keyId) {
        await tx.done;
        if (current.rawKeyB64 !== incoming.rawKeyB64) {
          logger.warn('meshKeyStore: key material changed without keyId rotation', { projectId });
          return null;
        }
        return current;
      }
      const currentVersion = meshKeyVersion(projectId, current.keyId);
      const incomingVersion = meshKeyVersion(projectId, incoming.keyId);
      if (currentVersion !== null && incomingVersion !== null) {
        if (incomingVersion < currentVersion) {
          await tx.done;
          return current;
        }
        if (incomingVersion === currentVersion) {
          await tx.done;
          logger.warn('meshKeyStore: conflicting material for same keyId version', { projectId });
          return null;
        }
      } else if (currentVersion !== null || incomingVersion === null) {
        // Refuse an ambiguous/unversioned rotation rather than let a delayed
        // response overwrite a key whose ordering cannot be established.
        await tx.done;
        logger.warn('meshKeyStore: ambiguous keyId rotation rejected', { projectId });
        return null;
      }
    }

    await tx.store.put(incoming);
    await tx.done;
    return incoming;
  });
  if (!selectedRecord) return null;

  memCache.delete(projectId);
  const signing = await getMeshSigningKey(projectId);
  const persisted = await db.get(STORE, projectId) as MeshKeyRecord | undefined;
  if (
    !signing || !persisted ||
    persisted.projectId !== projectId ||
    persisted.keyId !== selectedRecord.keyId ||
    persisted.rawKeyB64 !== selectedRecord.rawKeyB64 ||
    signing.keyId !== persisted.keyId
  ) {
    memCache.delete(projectId);
    logger.warn('meshKeyStore: persisted key changed during provision', { projectId });
    return null;
  }
  return signing;
}

/**
 * Fetch the project mesh key from the server (must be online + authed) and
 * persist it for offline use. Concurrent requests with the same project/auth
 * share one promise; project-scoped IDB transactions prevent stale keyId writes.
 */
export async function provisionMeshSigningKey(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MeshSigningKey | null> {
  try {
    const auth = await apiAuthHeader();
    if (!auth) {
      logger.warn('meshKeyStore: provision skipped — no auth');
      return null;
    }
    const operationKey = JSON.stringify([projectId, auth]);
    const existing = provisionInFlight.get(operationKey);
    if (existing) return await existing;

    const pending = fetchAndPersistMeshKey(projectId, auth, fetchImpl);
    provisionInFlight.set(operationKey, pending);
    try {
      return await pending;
    } finally {
      if (provisionInFlight.get(operationKey) === pending) {
        provisionInFlight.delete(operationKey);
      }
    }
  } catch (err) {
    logger.error('meshKeyStore: provision threw', err);
    return null;
  }
}

/** Test-only reset. */
export function __resetMeshKeyStoreForTests(): void {
  dbPromise = null;
  memCache.clear();
  provisionInFlight.clear();
  projectWriteLocks.clear();
}
