// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.9 — apiKeyService tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory firestore shim — same pattern as quotaTracker.test.ts.
const mocks = vi.hoisted(() => {
  const store = new Map<string, any>();

  const makeDocRef = (path: string) => ({
    path,
    get: async () => ({
      exists: store.has(path),
      data: () => store.get(path),
    }),
    set: async (data: any) => {
      store.set(path, { ...data });
    },
    update: async (data: any) => {
      const prev = store.get(path);
      if (!prev) throw new Error(`update on missing doc ${path}`);
      store.set(path, { ...prev, ...data });
    },
    delete: async () => {
      store.delete(path);
    },
  });

  const makeQuery = (col: string, filters: { field: string; value: unknown }[]) => ({
    where: (f: string, _op: string, v: unknown) => makeQuery(col, [...filters, { field: f, value: v }]),
    limit: (_n: number) => makeQuery(col, filters),
    get: async () => {
      const docs: any[] = [];
      for (const [path, data] of store.entries()) {
        if (!path.startsWith(`${col}/`)) continue;
        if (path.split('/').length !== 2) continue;
        if (!filters.every((f) => data[f.field] === f.value)) continue;
        docs.push({
          id: path.split('/')[1],
          data: () => data,
          ref: makeDocRef(path),
        });
      }
      return { empty: docs.length === 0, docs };
    },
  });

  const collectionFactory = (col: string) => ({
    doc: (id: string) => makeDocRef(`${col}/${id}`),
    where: (f: string, _op: string, v: unknown) => makeQuery(col, [{ field: f, value: v }]),
  });

  const firestoreFactory = () => ({ collection: collectionFactory });

  return { store, firestoreFactory };
});

vi.mock('firebase-admin', () => {
  const fs = mocks.firestoreFactory();
  return {
    default: { firestore: () => fs },
    firestore: () => fs,
  };
});

import {
  createApiKey,
  verifyApiKey,
  listApiKeys,
  revokeApiKey,
  __internals,
} from './apiKeyService.js';

beforeEach(() => {
  mocks.store.clear();
});

describe('apiKeyService', () => {
  it('creates a key with hashed storage and returns plaintext exactly once', async () => {
    const { key, record } = await createApiKey({
      customerId: 'cust-1',
      tier: 'climate-base',
      scopes: ['climate.read'],
    });
    expect(key).toMatch(/^pk_(live|test)_[0-9a-f]{24}$/);
    expect(record.keyHash).toBe(__internals.hashApiKey(key));
    expect(record.keyHash).not.toBe(key); // hash != plaintext
    expect(record.keyPrefix).toBe(key.slice(0, 12));
    expect(record.status).toBe('active');
    expect(record.scopes).toEqual(['climate.read']);

    // Stored doc must NOT contain plaintext anywhere.
    const stored = mocks.store.get(`b2d_api_keys/${record.id}`);
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(key);
  });

  it('verifyApiKey returns the record for a valid key', async () => {
    const { key, record } = await createApiKey({
      customerId: 'cust-1',
      tier: 'hazmat-base',
      scopes: ['hazmat.calculate'],
    });
    const verified = await verifyApiKey(key);
    expect(verified).not.toBeNull();
    expect(verified!.id).toBe(record.id);
    expect(verified!.customerId).toBe('cust-1');
  });

  it('verifyApiKey returns null for unknown keys, malformed input, and revoked keys', async () => {
    expect(await verifyApiKey('pk_test_unknown')).toBeNull();
    expect(await verifyApiKey('not-a-key')).toBeNull();
    // Empty / non-string treated as null.
    expect(await verifyApiKey('')).toBeNull();

    const { key, record } = await createApiKey({
      customerId: 'cust-2',
      tier: 'normativa-base',
      scopes: ['normativa.search'],
    });
    await revokeApiKey(record.id, 'admin-uid');
    expect(await verifyApiKey(key)).toBeNull();
  });

  it('respects scope assignments — suite.all is the blanket grant', async () => {
    const { record } = await createApiKey({
      customerId: 'cust-3',
      tier: 'suite-pro',
      scopes: ['suite.all'],
    });
    expect(record.scopes).toEqual(['suite.all']);

    const { record: scoped } = await createApiKey({
      customerId: 'cust-3',
      tier: 'climate-base',
      scopes: ['climate.read'],
    });
    expect(scoped.scopes).toEqual(['climate.read']);
    expect(scoped.scopes.includes('suite.all' as any)).toBe(false);
  });

  it('expires keys past their expiresAt and returns null on verify', async () => {
    const { key, record } = await createApiKey({
      customerId: 'cust-4',
      tier: 'climate-base',
      scopes: ['climate.read'],
      expiresInDays: 1,
    });
    expect(record.expiresAt).toBeGreaterThan(Date.now());

    // Manually rewind expiresAt into the past in the in-memory store.
    const stored = mocks.store.get(`b2d_api_keys/${record.id}`);
    stored.expiresAt = Date.now() - 1000;

    expect(await verifyApiKey(key)).toBeNull();
    // Lazily marked expired so admin lists reflect reality. Re-fetch
    // because the mock's `update` writes a new object via `store.set`
    // rather than mutating in place.
    const updated = mocks.store.get(`b2d_api_keys/${record.id}`);
    expect(updated.status).toBe('expired');
  });

  it('revokeApiKey is idempotent and records who revoked', async () => {
    const { record } = await createApiKey({
      customerId: 'cust-5',
      tier: 'climate-base',
      scopes: ['climate.read'],
    });
    await revokeApiKey(record.id, 'admin-A');
    await revokeApiKey(record.id, 'admin-B'); // second call should not throw
    const stored = mocks.store.get(`b2d_api_keys/${record.id}`);
    expect(stored.status).toBe('revoked');
    expect(stored.revokedBy).toBe('admin-B');
    expect(stored.revokedAt).toBeGreaterThan(0);
  });

  it('listApiKeys returns all keys belonging to a customer regardless of status', async () => {
    await createApiKey({ customerId: 'cust-6', tier: 'climate-base', scopes: ['climate.read'] });
    await createApiKey({ customerId: 'cust-6', tier: 'hazmat-base', scopes: ['hazmat.calculate'] });
    const other = await createApiKey({ customerId: 'cust-X', tier: 'climate-base', scopes: ['climate.read'] });
    await revokeApiKey(other.record.id, 'admin');

    const list = await listApiKeys('cust-6');
    expect(list).toHaveLength(2);
    expect(new Set(list.map((k) => k.tier))).toEqual(new Set(['climate-base', 'hazmat-base']));
  });

  it('hash is deterministic and prefix never reveals full key', async () => {
    const sameHash = __internals.hashApiKey('pk_test_aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(sameHash).toBe(__internals.hashApiKey('pk_test_aaaaaaaaaaaaaaaaaaaaaaaa'));
    // Different inputs → different hashes (collision resistance proxy).
    expect(__internals.hashApiKey('a')).not.toBe(__internals.hashApiKey('b'));
    // Hash output is hex SHA-256 → 64 chars.
    expect(sameHash).toMatch(/^[0-9a-f]{64}$/);

    const { key, record } = await createApiKey({
      customerId: 'cust-7',
      tier: 'climate-base',
      scopes: ['climate.read'],
    });
    // Prefix is 12 chars, key is 32 — prefix cannot reconstruct key.
    expect(record.keyPrefix.length).toBeLessThan(key.length);
    expect(key.startsWith(record.keyPrefix)).toBe(true);
  });

  it('rejects bad input', async () => {
    await expect(
      createApiKey({ customerId: '', tier: 'climate-base', scopes: ['climate.read'] }),
    ).rejects.toThrow();
    await expect(
      createApiKey({ customerId: 'c', tier: 'climate-base', scopes: [] }),
    ).rejects.toThrow();
    await expect(
      createApiKey({
        customerId: 'c',
        tier: 'climate-base',
        scopes: ['climate.read'],
        expiresInDays: -1,
      }),
    ).rejects.toThrow();
  });
});
