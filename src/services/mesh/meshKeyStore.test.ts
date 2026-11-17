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
  getMeshSigningKeyDetailed,
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
  it('classifies an absent record as missing', async () => {
    await expect(getMeshSigningKeyDetailed(PROJECT_ID)).resolves.toEqual({
      status: 'missing',
    });
  });

  it('returns the valid cached key in the detailed result', async () => {
    await seedKey(toBase64(new Uint8Array(32).fill(0x2a)));

    const result = await getMeshSigningKeyDetailed(PROJECT_ID);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected cached key');
    expect(result.key.keyId).toBe(`${PROJECT_ID}:v1`);
  });

  it('classifies unavailable WebCrypto without deleting the valid record', async () => {
    const validKey = toBase64(new Uint8Array(32).fill(0x2a));
    await seedKey(validKey);
    vi.stubGlobal('crypto', { subtle: undefined } as unknown as Crypto);

    await expect(getMeshSigningKeyDetailed(PROJECT_ID)).resolves.toEqual({
      status: 'crypto-unavailable',
    });
    expect(await readKeyRecord()).toMatchObject({ rawKeyB64: validKey });
  });

  it('classifies and removes a malformed persisted record', async () => {
    await seedKey('not-base64!');

    await expect(getMeshSigningKeyDetailed(PROJECT_ID)).resolves.toEqual({
      status: 'corrupt',
    });
    expect(await readKeyRecord()).toBeUndefined();
  });

  it('classifies IndexedDB open failure separately from a missing record', async () => {
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => { throw new Error('IndexedDB unavailable'); }),
    });

    await expect(getMeshSigningKeyDetailed(PROJECT_ID)).resolves.toEqual({
      status: 'storage-error',
    });
  });

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

  it('coalesces concurrent provisioning for the same project and auth scope', async () => {
    const validKey = toBase64(new Uint8Array(32).fill(0x2a));
    let releaseResponse!: (response: Response) => void;
    const delayedResponse = new Promise<Response>((resolve) => { releaseResponse = resolve; });
    const fetchImpl = vi.fn(async () => delayedResponse) as unknown as typeof fetch;

    const first = provisionMeshSigningKey(PROJECT_ID, fetchImpl);
    const second = provisionMeshSigningKey(PROJECT_ID, fetchImpl);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    releaseResponse(responseWithKey(`${PROJECT_ID}:v1`, validKey));
    const [firstKey, secondKey] = await Promise.all([first, second]);
    expect(firstKey?.keyId).toBe(`${PROJECT_ID}:v1`);
    expect(secondKey).toBe(firstKey);
    expect(await readKeyRecord()).toMatchObject({ keyId: `${PROJECT_ID}:v1`, rawKeyB64: validKey });
  });

  it('does not let a delayed older keyId overwrite a newer key already persisted', async () => {
    const oldKey = toBase64(new Uint8Array(32).fill(0x11));
    const newKey = toBase64(new Uint8Array(32).fill(0x22));
    let releaseOld!: (response: Response) => void;
    let releaseNew!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { releaseOld = resolve; });
    const newResponse = new Promise<Response>((resolve) => { releaseNew = resolve; });
    vi.mocked(apiAuthHeader)
      .mockResolvedValueOnce('Bearer caller-a')
      .mockResolvedValueOnce('Bearer caller-b');
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>)?.Authorization;
      return authorization === 'Bearer caller-a' ? oldResponse : newResponse;
    }) as unknown as typeof fetch;

    const olderProvision = provisionMeshSigningKey(PROJECT_ID, fetchImpl);
    const newerProvision = provisionMeshSigningKey(PROJECT_ID, fetchImpl);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    releaseNew(responseWithKey(`${PROJECT_ID}:v3`, newKey));
    const newer = await newerProvision;
    releaseOld(responseWithKey(`${PROJECT_ID}:v2`, oldKey));
    const older = await olderProvision;

    expect(newer?.keyId).toBe(`${PROJECT_ID}:v3`);
    expect(older?.keyId).toBe(`${PROJECT_ID}:v3`);
    expect(await readKeyRecord()).toMatchObject({ keyId: `${PROJECT_ID}:v3`, rawKeyB64: newKey });
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

  it('rejects a keyId outside the requested project without writing IndexedDB', async () => {
    const validKey = toBase64(new Uint8Array(32).fill(0x2a));
    const fetchImpl = vi.fn(async () =>
      responseWithKey('different-project:v1', validKey),
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
