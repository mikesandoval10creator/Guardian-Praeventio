// SPDX-License-Identifier: MIT
// Exercises the real key-store module against fake-indexeddb and real WebCrypto.
// No mesh/IndexedDB operations are mocked: corruption and provisioning are
// observed at the persistent store boundary.
import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-member'),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { apiAuthHeader } from '../../lib/apiAuth';
import {
  __resetMeshKeyStoreForTests,
  getMeshSigningKey,
  provisionMeshSigningKey,
} from './meshKeyStore';

const DB_NAME = 'praeventio-mesh-keys';
const STORE = 'keys';
const PROJECT_ID = 'project-mesh-test';

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function openTestDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'projectId' });
      }
    },
  });
}

async function seedKey(rawKeyB64: string, keyId = `${PROJECT_ID}:v1`): Promise<void> {
  const db = await openTestDb();
  await db.put(STORE, {
    projectId: PROJECT_ID,
    keyId,
    rawKeyB64,
    fetchedAt: '2026-09-27T00:00:00.000Z',
  });
  db.close();
}

async function readKeyRecord(): Promise<unknown> {
  const db = await openTestDb();
  const record = await db.get(STORE, PROJECT_ID);
  db.close();
  return record;
}

function responseWithKey(keyId: string, key: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ keyId, key }),
  } as unknown as Response;
}

describe('meshKeyStore corruption recovery', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    vi.stubGlobal('crypto', webcrypto as unknown as Crypto);
    __resetMeshKeyStoreForTests();
    vi.mocked(apiAuthHeader).mockResolvedValue('Bearer test-member');
  });

  afterEach(async () => {
    __resetMeshKeyStoreForTests();
    vi.unstubAllGlobals();
    // fake-indexeddb schedules transaction completion with setImmediate.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it.each([
    ['invalid Base64', 'not-base64!'],
    ['a decoded key shorter than 32 bytes', toBase64(new Uint8Array(31).fill(0x2a))],
  ])('rejects %s server key material without writing to IndexedDB', async (_case, invalidKey) => {
    const fetchImpl = vi.fn(async () =>
      responseWithKey(`${PROJECT_ID}:v2`, invalidKey),
    ) as unknown as typeof fetch;

    await expect(provisionMeshSigningKey(PROJECT_ID, fetchImpl)).resolves.toBeNull();
    expect(await readKeyRecord()).toBeUndefined();
  });

  it('deletes a corrupt cold-start IDB record and can provision a fresh valid key', async () => {
    await seedKey('not-base64!');

    await expect(getMeshSigningKey(PROJECT_ID)).resolves.toBeNull();
    expect(await readKeyRecord()).toBeUndefined();

    const validKey = toBase64(new Uint8Array(32).fill(0x2a));
    const fetchImpl = vi.fn(async () =>
      responseWithKey(`${PROJECT_ID}:v2`, validKey),
    ) as unknown as typeof fetch;

    const signing = await provisionMeshSigningKey(PROJECT_ID, fetchImpl);
    expect(signing?.keyId).toBe(`${PROJECT_ID}:v2`);
    expect(signing?.key.algorithm).toMatchObject({
      name: 'HMAC',
      hash: { name: 'SHA-256' },
    });
    expect(signing?.key.extractable).toBe(false);
    expect(await readKeyRecord()).toMatchObject({
      projectId: PROJECT_ID,
      keyId: `${PROJECT_ID}:v2`,
      rawKeyB64: validKey,
    });
  });

  it('deletes the persisted record when WebCrypto rejects a valid-length key import', async () => {
    await seedKey(toBase64(new Uint8Array(32).fill(0x2a)));
    const importKey = vi.fn().mockRejectedValue(new Error('unsupported key import'));
    vi.stubGlobal('crypto', { subtle: { importKey } } as unknown as Crypto);

    await expect(getMeshSigningKey(PROJECT_ID)).resolves.toBeNull();
    expect(importKey).toHaveBeenCalledTimes(1);
    expect(await readKeyRecord()).toBeUndefined();
  });

  it('keeps a valid persisted record when WebCrypto is unavailable', async () => {
    const validKey = toBase64(new Uint8Array(32).fill(0x2a));
    await seedKey(validKey);
    vi.stubGlobal('crypto', { subtle: undefined } as unknown as Crypto);

    await expect(getMeshSigningKey(PROJECT_ID)).resolves.toBeNull();
    expect(await readKeyRecord()).toMatchObject({
      projectId: PROJECT_ID,
      rawKeyB64: validKey,
    });
  });
});
