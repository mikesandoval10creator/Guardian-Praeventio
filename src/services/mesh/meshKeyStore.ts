// SPDX-License-Identifier: MIT
//
// On-device cache + provisioning for the per-project mesh HMAC signing key.
//
// The key is minted server-side and returned ONLY to authenticated project
// members (GET /api/mesh/key, gated by verifyAuth + assertProjectMember). We
// fetch it while online, import it as a non-extractable HMAC CryptoKey, and
// persist the raw bytes in IndexedDB so the device can keep signing/verifying
// mesh packets OFFLINE (tunnel, no cell signal). The raw bytes are needed in
// IDB because importKey re-creates the CryptoKey after a cold start; the IDB
// itself is protected at rest by SQLCipher on native (CLAUDE.md #16) and by
// the OS sandbox on web — and the key is project-scoped, not user PII.
//
// Mirrors deviceKek.ts (idb store) + slm/hmac.ts (importKey raw HMAC).

import { openDB, type IDBPDatabase } from 'idb';
import type { MeshSigningKey } from './meshPacketSigner';
import { apiAuthHeader } from '../../lib/apiAuth';
import { logger } from '../../utils/logger';

const DB_NAME = 'praeventio-mesh-keys';
const STORE = 'keys';
const DB_VERSION = 1;

interface MeshKeyRecord {
  projectId: string;
  keyId: string;
  rawKeyB64: string;
  fetchedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
const memCache = new Map<string, MeshSigningKey>();

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
  const s = globalThis.atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importHmacKey(rawKeyB64: string): Promise<CryptoKey | null> {
  const subtle = getSubtle();
  if (!subtle) return null;
  return subtle.importKey(
    'raw',
    base64ToBytes(rawKeyB64) as unknown as BufferSource,
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
    const key = await importHmacKey(rec.rawKeyB64);
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
export async function provisionMeshSigningKey(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MeshSigningKey | null> {
  try {
    // No auth header → not signed in (or no E2E fixture). Cannot provision;
    // the device keeps running unkeyed until a member token is available.
    const auth = await apiAuthHeader();
    if (!auth) {
      logger.warn('meshKeyStore: provision skipped — no auth');
      return null;
    }
    const res = await fetchImpl(
      `/api/mesh/key?projectId=${encodeURIComponent(projectId)}`,
      { headers: { Authorization: auth } },
    );
    if (!res.ok) {
      logger.warn('meshKeyStore: provision failed', { status: res.status });
      return null;
    }
    const body = (await res.json()) as { keyId?: unknown; key?: unknown };
    if (typeof body.keyId !== 'string' || typeof body.key !== 'string') {
      return null;
    }
    const db = await getDb();
    await db.put(STORE, {
      projectId,
      keyId: body.keyId,
      rawKeyB64: body.key,
      fetchedAt: new Date().toISOString(),
    } satisfies MeshKeyRecord);
    memCache.delete(projectId);
    return getMeshSigningKey(projectId);
  } catch (err) {
    logger.error('meshKeyStore: provision threw', err);
    return null;
  }
}

/** Test-only reset. */
export function __resetMeshKeyStoreForTests(): void {
  dbPromise = null;
  memCache.clear();
}
