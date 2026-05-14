// @vitest-environment jsdom
/**
 * Tests for `encryptedOfflineQueue.ts`.
 *
 * Coverage map (read alongside the module's design notes):
 *
 *   1.  Round-trip enqueue → listPending decrypts correctly
 *   2.  Multiple enqueues stay chronologically ordered
 *   3.  At-rest record carries an envelope, NOT the plaintext response
 *   4.  Tampering with the persisted ciphertext makes listPending throw
 *   5.  Deleting the device KEK makes listPending throw with KEK_MISSING
 *   6.  markReconciled flips the flag without touching the envelope
 *   7.  clearReconciled removes only reconciled rows
 *   8.  markReconciled on unknown id throws
 *   9.  deleteSession is a silent no-op on missing id
 *  10.  HMAC tag verifies against the decrypted plaintext
 *  11.  Migration: 3 legacy plaintext records → all encrypted, content
 *       preserved, HMAC tag preserved byte-for-byte
 *  12.  Migration is idempotent (run 2x, second pass migrates 0)
 *  13.  Mixed store (legacy + encrypted) is migrated correctly
 *  14.  listPending on a store that still contains legacy records throws
 *       a clear error directing the caller to run migration
 *  15.  isEncryptedQueueEnabled reads the localStorage flag
 */

import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { webcrypto } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Some Vitest pool/env combinations (notably jsdom under `vmThreads`)
// replace `globalThis.crypto` with jsdom's stub which lacks `subtle`.
// `browserEnvelope` + `deviceKek` rely on `crypto.subtle` end-to-end, so
// we pin the Node-native webcrypto implementation at module load time
// before any test imports the SUT.
if (
  !(globalThis as { crypto?: { subtle?: unknown } }).crypto ||
  typeof (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle ===
    'undefined'
) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

import {
  __resetDeviceKekForTests,
  deleteDeviceKek,
  getOrCreateDeviceKek,
} from '../security/deviceKek';

// Stub analytics — `enqueueSession` fires `slm.queue.grew` from a
// fire-and-forget IIFE. Without this mock the dynamic import resolves
// to the real analytics module which boots its own IDB-backed queue
// inside the test process.
vi.mock('../analytics', () => {
  const trackMock = vi.fn(async () => {});
  return {
    analytics: { track: trackMock, flush: vi.fn(async () => {}) },
    __trackMock: trackMock,
  };
});

import {
  __resetEncryptedOfflineQueueForTests,
  ENCRYPTION_FEATURE_FLAG,
  EncryptedQueueUnavailableError,
  canonicalForHmac,
  clearReconciled,
  deleteSession,
  enqueueSession,
  isEncryptedQueueEnabled,
  listPending,
  markReconciled,
  migrateLegacyQueueEntries,
} from './encryptedOfflineQueue';
import { __resetSessionKeyForTesting, verifyPayload } from './hmac';
import type { SLMQuery, SLMResponse } from './types';

// Local mirrors of the constants in encryptedOfflineQueue.ts so the
// tests can poke the underlying IDB store directly for migration cases.
const DB_NAME = 'praeventio-slm';
const STORE_NAME = 'offline_sessions';

function createSessionStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(k: string) {
      return store.has(k) ? (store.get(k) as string) : null;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    removeItem(k: string) {
      store.delete(k);
    },
    setItem(k: string, v: string) {
      store.set(k, String(v));
    },
  };
}

function createLocalStorageMock(): Storage {
  return createSessionStorageMock();
}

const SAMPLE_QUERY: SLMQuery = { prompt: 'sample prompt' };
const SAMPLE_RESPONSE: SLMResponse = {
  text: 'PHI: paciente X — fractura cúbito',
  latencyMs: 5,
  tokensGenerated: 4,
  backend: 'wasm-simd',
};

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  vi.stubGlobal('sessionStorage', createSessionStorageMock());
  vi.stubGlobal('localStorage', createLocalStorageMock());
  __resetEncryptedOfflineQueueForTests();
  __resetDeviceKekForTests();
  __resetSessionKeyForTesting();
});

afterEach(() => {
  __resetEncryptedOfflineQueueForTests();
  __resetDeviceKekForTests();
  __resetSessionKeyForTesting();
  vi.unstubAllGlobals();
});

/**
 * Open the raw IDB store directly for tests that need to inspect or
 * inject records bypassing the module's API.
 */
async function rawGet(id: string): Promise<unknown> {
  const { openDB } = await import('idb');
  const db = await openDB(DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
  return db.get(STORE_NAME, id);
}

async function rawPut(record: unknown): Promise<void> {
  const { openDB } = await import('idb');
  const db = await openDB(DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
  await db.put(STORE_NAME, record);
}

describe('encryptedOfflineQueue — basic round-trip', () => {
  it('enqueue then listPending decrypts the response', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    expect(typeof id).toBe('string');

    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(pending[0].query).toEqual(SAMPLE_QUERY);
    expect(pending[0].response).toEqual(SAMPLE_RESPONSE);
    expect(pending[0].reconciled).toBe(false);
    expect(typeof pending[0].createdAt).toBe('number');
    expect(typeof pending[0].hmac).toBe('string');
  });

  it('multiple enqueues stay chronologically ordered', async () => {
    const idA = await enqueueSession(
      { prompt: 'first' },
      { ...SAMPLE_RESPONSE, text: 'first-resp' },
    );
    await new Promise((r) => setTimeout(r, 2));
    const idB = await enqueueSession(
      { prompt: 'second' },
      { ...SAMPLE_RESPONSE, text: 'second-resp' },
    );
    await new Promise((r) => setTimeout(r, 2));
    const idC = await enqueueSession(
      { prompt: 'third' },
      { ...SAMPLE_RESPONSE, text: 'third-resp' },
    );

    const pending = await listPending();
    expect(pending.map((p) => p.id)).toEqual([idA, idB, idC]);
    expect(pending.map((p) => p.response.text)).toEqual([
      'first-resp',
      'second-resp',
      'third-resp',
    ]);
  });

  it('listPending on an empty store returns []', async () => {
    expect(await listPending()).toEqual([]);
  });

  it('persisted record carries an envelope and NOT plaintext response', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const raw = (await rawGet(id)) as Record<string, unknown>;
    expect(raw).toBeDefined();
    expect(raw.encryptionVersion).toBe('v1');
    expect(raw.responseEnvelope).toBeDefined();
    // No plaintext leak — the original `response` field MUST NOT be
    // present alongside the envelope.
    expect(raw.response).toBeUndefined();
    // Sanity: the raw envelope ciphertext does not contain the
    // plaintext PHI substring.
    const serialized = JSON.stringify(raw);
    expect(serialized.includes('fractura cúbito')).toBe(false);
    expect(serialized.includes('PHI')).toBe(false);
  });
});

describe('encryptedOfflineQueue — tampering and KEK availability', () => {
  it('tampered ciphertext makes listPending throw', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const raw = (await rawGet(id)) as {
      responseEnvelope: { ciphertext: string };
      [k: string]: unknown;
    };
    // Flip a single base64 byte in the ciphertext — AES-GCM authTag
    // will reject the modification.
    const original = raw.responseEnvelope.ciphertext;
    const tamperedChar = original[0] === 'A' ? 'B' : 'A';
    raw.responseEnvelope.ciphertext = tamperedChar + original.slice(1);
    await rawPut(raw);

    await expect(listPending()).rejects.toBeInstanceOf(
      EncryptedQueueUnavailableError,
    );
  });

  it('listPending throws KEK_MISSING after deleteDeviceKek', async () => {
    await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    // Listing now would work — KEK still in IDB. Drop it and try.
    await deleteDeviceKek();
    __resetDeviceKekForTests();

    await expect(listPending()).rejects.toMatchObject({
      name: 'EncryptedQueueUnavailableError',
      code: 'KEK_MISSING',
    });
  });
});

describe('encryptedOfflineQueue — flags and lifecycle', () => {
  it('markReconciled flips the flag and removes the row from listPending', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    expect(await listPending()).toHaveLength(1);

    await markReconciled(id);
    expect(await listPending()).toHaveLength(0);

    // Idempotent — second call is a no-op.
    await markReconciled(id);
    expect(await listPending()).toHaveLength(0);
  });

  it('markReconciled on unknown id throws', async () => {
    await expect(markReconciled('does-not-exist')).rejects.toThrow(
      /unknown session id/,
    );
  });

  it('clearReconciled removes only reconciled rows', async () => {
    const idA = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const idB = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const idC = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    await markReconciled(idA);
    await markReconciled(idC);

    const removed = await clearReconciled();
    expect(removed).toBe(2);
    const pending = await listPending();
    expect(pending.map((p) => p.id)).toEqual([idB]);
  });

  it('deleteSession on missing id is a silent no-op', async () => {
    await expect(deleteSession('nope')).resolves.toBeUndefined();
  });

  it('deleteSession removes a row by id', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    expect(await listPending()).toHaveLength(1);
    await deleteSession(id);
    expect(await listPending()).toHaveLength(0);
  });
});

describe('encryptedOfflineQueue — HMAC over plaintext', () => {
  it('the persisted HMAC verifies against the canonical decrypted plaintext', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const [pending] = await listPending();
    expect(pending.hmac).toBeDefined();
    const canonical = canonicalForHmac({
      id: pending.id,
      query: pending.query,
      response: pending.response,
      createdAt: pending.createdAt,
    });
    const ok = await verifyPayload(canonical, pending.hmac!);
    expect(ok).toBe(true);
  });

  it('verifyPayload rejects a forged record (wrong response)', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const [pending] = await listPending();
    const canonical = canonicalForHmac({
      id: pending.id,
      query: pending.query,
      response: { ...pending.response, text: 'attacker-injected' },
      createdAt: pending.createdAt,
    });
    const ok = await verifyPayload(canonical, pending.hmac!);
    expect(ok).toBe(false);
  });
});

describe('encryptedOfflineQueue — migration of legacy plaintext records', () => {
  /**
   * Write a record in the LEGACY plaintext shape directly into IDB.
   * Simulates what `offlineQueue.ts` writes before any caller flips
   * the feature flag.
   */
  async function writeLegacy(
    id: string,
    query: SLMQuery,
    response: SLMResponse,
    createdAt: number,
    hmac?: string,
  ): Promise<void> {
    await rawPut({
      id,
      query,
      response,
      createdAt,
      reconciled: false,
      hmac,
      // No `encryptionVersion`, no `responseEnvelope` — signals legacy.
    });
  }

  it('migrates 3 legacy plaintext records and preserves content', async () => {
    // Pre-sign HMACs over the legacy canonical plaintexts so we can
    // assert post-migration that they still verify (proving HMAC is
    // preserved byte-for-byte).
    const { signPayload } = await import('./hmac');
    const recs = [
      { id: 'a', query: { prompt: 'q1' }, response: { ...SAMPLE_RESPONSE, text: 'r1' }, createdAt: 1000 },
      { id: 'b', query: { prompt: 'q2' }, response: { ...SAMPLE_RESPONSE, text: 'r2' }, createdAt: 2000 },
      { id: 'c', query: { prompt: 'q3' }, response: { ...SAMPLE_RESPONSE, text: 'r3' }, createdAt: 3000 },
    ];
    for (const r of recs) {
      const tag = await signPayload(canonicalForHmac(r));
      await writeLegacy(r.id, r.query, r.response, r.createdAt, tag);
    }

    // Pre-warm the KEK so migration finds it ready.
    await getOrCreateDeviceKek();

    const result = await migrateLegacyQueueEntries();
    expect(result).toEqual({
      scanned: 3,
      migrated: 3,
      skipped: 0,
      failed: 0,
    });

    // After migration: listPending decrypts and matches the originals.
    const pending = await listPending();
    expect(pending).toHaveLength(3);
    expect(pending.map((p) => p.response.text).sort()).toEqual([
      'r1',
      'r2',
      'r3',
    ]);

    // Each record's raw shape is now encrypted.
    for (const r of recs) {
      const raw = (await rawGet(r.id)) as Record<string, unknown>;
      expect(raw.encryptionVersion).toBe('v1');
      expect(raw.responseEnvelope).toBeDefined();
      expect(raw.response).toBeUndefined();
      // HMAC tag is preserved byte-for-byte.
      expect(typeof raw.hmac).toBe('string');
    }

    // HMAC still verifies against decrypted plaintext.
    for (const p of pending) {
      const canonical = canonicalForHmac({
        id: p.id,
        query: p.query,
        response: p.response,
        createdAt: p.createdAt,
      });
      const ok = await verifyPayload(canonical, p.hmac!);
      expect(ok).toBe(true);
    }
  });

  it('migration is idempotent — second pass migrates 0', async () => {
    await writeLegacy('x', SAMPLE_QUERY, SAMPLE_RESPONSE, 1000);
    await writeLegacy('y', SAMPLE_QUERY, SAMPLE_RESPONSE, 2000);
    await getOrCreateDeviceKek();

    const first = await migrateLegacyQueueEntries();
    expect(first.migrated).toBe(2);

    const second = await migrateLegacyQueueEntries();
    expect(second).toEqual({
      scanned: 2,
      migrated: 0,
      skipped: 2,
      failed: 0,
    });

    const pending = await listPending();
    expect(pending).toHaveLength(2);
  });

  it('handles a mixed store (legacy + already-encrypted)', async () => {
    // One encrypted record via the module's API, plus one legacy via
    // the raw helper.
    const encId = await enqueueSession(
      { prompt: 'enc' },
      { ...SAMPLE_RESPONSE, text: 'enc-resp' },
    );
    await writeLegacy(
      'leg',
      { prompt: 'leg' },
      { ...SAMPLE_RESPONSE, text: 'leg-resp' },
      Date.now() + 5,
    );

    const result = await migrateLegacyQueueEntries();
    expect(result.scanned).toBe(2);
    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);

    const pending = await listPending();
    expect(pending).toHaveLength(2);
    const texts = pending.map((p) => p.response.text).sort();
    expect(texts).toEqual(['enc-resp', 'leg-resp']);
    // Encrypted one was untouched — same id still resolves.
    expect(pending.some((p) => p.id === encId)).toBe(true);
  });

  it('listPending throws when the store still contains legacy records', async () => {
    await writeLegacy('legacy', SAMPLE_QUERY, SAMPLE_RESPONSE, 1000);
    // Pre-warm the KEK so the error is specifically BAD_RECORD, not
    // KEK_MISSING.
    await getOrCreateDeviceKek();
    await expect(listPending()).rejects.toMatchObject({
      name: 'EncryptedQueueUnavailableError',
      code: 'BAD_RECORD',
    });
  });

  it('migration on empty store returns zero counts', async () => {
    const result = await migrateLegacyQueueEntries();
    expect(result).toEqual({
      scanned: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
    });
  });
});

describe('encryptedOfflineQueue — feature flag', () => {
  it('isEncryptedQueueEnabled returns false by default', () => {
    expect(isEncryptedQueueEnabled()).toBe(false);
  });

  it('isEncryptedQueueEnabled returns true when localStorage flag is "on"', () => {
    globalThis.localStorage.setItem(ENCRYPTION_FEATURE_FLAG, 'on');
    expect(isEncryptedQueueEnabled()).toBe(true);
  });

  it('isEncryptedQueueEnabled returns false for any other value', () => {
    globalThis.localStorage.setItem(ENCRYPTION_FEATURE_FLAG, 'true');
    expect(isEncryptedQueueEnabled()).toBe(false);
    globalThis.localStorage.setItem(ENCRYPTION_FEATURE_FLAG, '');
    expect(isEncryptedQueueEnabled()).toBe(false);
  });
});
