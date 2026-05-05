// Praeventio Guard — Sprint 22 prod hardening (Bucket X) tests.
//
// Vitest harness for `quotaTracker.ts`. Mocks `firebase-admin` with a
// minimal in-memory store + transaction shim, mirroring the pattern in
// `mercadoPagoIpn.test.ts`. Tests cover:
//
//   1. trackGeminiUsage creates a doc when none exists for the day.
//   2. trackGeminiUsage increments existing counters atomically.
//   3. checkQuotaLimit allows when under tier ceiling.
//   4. checkQuotaLimit blocks when over tier request ceiling.
//   5. resetQuota deletes the day's doc.
//   6. Idempotency: same idempotencyKey across retries does not double-count.
//   7. Multi-tenant isolation: tenant A's writes don't bleed into B.
//   8. Diamond tier: no hard request ceiling enforced.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoisted in-memory firestore mock shared between vi.mock factory + tests.
const mocks = vi.hoisted(() => {
  type StoreEntry = { data: any };
  const store = new Map<string, StoreEntry>();
  const setSpy = vi.fn();
  const updateSpy = vi.fn();
  const deleteSpy = vi.fn();

  const makeDocRef = (path: string) => ({
    path,
    get: async () => {
      const entry = store.get(path);
      return {
        exists: !!entry,
        data: () => entry?.data,
      };
    },
    set: async (data: any) => {
      setSpy(path, data);
      store.set(path, { data: { ...data } });
    },
    update: async (data: any) => {
      updateSpy(path, data);
      const prev = store.get(path);
      if (!prev) throw new Error(`update on missing doc ${path}`);
      store.set(path, { data: { ...prev.data, ...data } });
    },
    delete: async () => {
      deleteSpy(path);
      store.delete(path);
    },
    collection: (sub: string) => ({
      doc: (id: string) => makeDocRef(`${path}/${sub}/${id}`),
    }),
  });

  const collectionFactory = (col: string) => ({
    doc: (id: string) => makeDocRef(`${col}/${id}`),
    where: (_field: string, _op: string, _value: string) => ({
      orderBy: (_orderField: string, _direction: 'asc' | 'desc') => ({
        limit: (_n: number) => ({
          get: async () => {
            const docs: any[] = [];
            for (const [path, entry] of store.entries()) {
              if (!path.startsWith(`${col}/`)) continue;
              if (path.split('/').length !== 2) continue; // skip subcollections
              docs.push({
                id: path.split('/')[1],
                data: () => entry.data,
              });
            }
            return { docs };
          },
        }),
      }),
    }),
  });

  // Transaction implementation: serial reads/writes, applied immediately
  // (no rollback needed because tests don't simulate conflicts).
  const runTransaction = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    const tx = {
      get: async (ref: any) => ref.get(),
      set: (ref: any, data: any) => ref.set(data),
      update: (ref: any, data: any) => ref.update(data),
      delete: (ref: any) => ref.delete(),
    };
    return fn(tx);
  };

  const FieldValue = {
    serverTimestamp: () => ({ __ts: true }),
    increment: (n: number) => ({ __increment: n }),
  };

  const firestoreFactory = () =>
    Object.assign(
      {
        collection: collectionFactory,
        runTransaction,
      },
      { FieldValue },
    );

  return { store, setSpy, updateSpy, deleteSpy, firestoreFactory, FieldValue };
});

vi.mock('firebase-admin', () => {
  const fs = mocks.firestoreFactory();
  const FieldValue = mocks.FieldValue;
  return {
    default: {
      firestore: Object.assign(() => fs, { FieldValue }),
    },
    firestore: Object.assign(() => fs, { FieldValue }),
  };
});

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Imports AFTER vi.mock so the module under test sees the stubs.
import {
  trackGeminiUsage,
  checkQuotaLimit,
  resetQuota,
  getUsage,
  todayUtc,
  normalizeTier,
} from './quotaTracker.js';

beforeEach(() => {
  mocks.store.clear();
  mocks.setSpy.mockReset();
  mocks.updateSpy.mockReset();
  mocks.deleteSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('normalizeTier', () => {
  it('keeps explicit quota tiers intact', () => {
    expect(normalizeTier('bronze')).toBe('bronze');
    expect(normalizeTier('diamond')).toBe('diamond');
  });
  it('maps B2D pro tiers to gold and base tiers to silver', () => {
    expect(normalizeTier('hazmat-pro')).toBe('gold');
    expect(normalizeTier('suite-pro')).toBe('gold');
    expect(normalizeTier('climate-base')).toBe('silver');
  });
  it('falls back to bronze for unknown / nullish tiers', () => {
    expect(normalizeTier(null)).toBe('bronze');
    expect(normalizeTier(undefined)).toBe('bronze');
    expect(normalizeTier('foo-tier')).toBe('bronze');
  });
});

describe('trackGeminiUsage', () => {
  it('creates a fresh quota doc when none exists for the day', async () => {
    const date = todayUtc();
    const usage = await trackGeminiUsage('tenant-A', 1500, 0.42, { date });
    expect(usage).toMatchObject({
      tenantId: 'tenant-A',
      date,
      geminiTokens: 1500,
      geminiRequests: 1,
    });
    expect(usage.geminiCostUsd).toBeCloseTo(0.42, 6);
    expect(mocks.setSpy).toHaveBeenCalledTimes(1);
    expect(mocks.setSpy.mock.calls[0][0]).toBe(`quota_usage/tenant-A__${date}`);
  });

  it('increments counters when a doc already exists', async () => {
    const date = todayUtc();
    await trackGeminiUsage('tenant-A', 1000, 0.10, { date });
    const second = await trackGeminiUsage('tenant-A', 500, 0.05, { date });
    expect(second.geminiTokens).toBe(1500);
    expect(second.geminiRequests).toBe(2);
    expect(second.geminiCostUsd).toBeCloseTo(0.15, 6);
    expect(mocks.updateSpy).toHaveBeenCalledTimes(1);
  });

  it('does not double-count on retry when idempotencyKey is reused', async () => {
    const date = todayUtc();
    const a = await trackGeminiUsage('tenant-A', 100, 0.01, {
      date,
      idempotencyKey: 'req-xyz',
    });
    const b = await trackGeminiUsage('tenant-A', 100, 0.01, {
      date,
      idempotencyKey: 'req-xyz',
    });
    expect(a.geminiRequests).toBe(1);
    expect(b.geminiRequests).toBe(1);
    expect(b.geminiTokens).toBe(100);
    expect(b.geminiCostUsd).toBeCloseTo(0.01, 6);
  });

  it('isolates counters per tenant', async () => {
    const date = todayUtc();
    await trackGeminiUsage('tenant-A', 1000, 0.10, { date });
    await trackGeminiUsage('tenant-B', 5000, 1.00, { date });
    const usageA = await getUsage('tenant-A', date);
    const usageB = await getUsage('tenant-B', date);
    expect(usageA.geminiTokens).toBe(1000);
    expect(usageB.geminiTokens).toBe(5000);
    expect(usageA.geminiCostUsd).toBeCloseTo(0.10, 6);
    expect(usageB.geminiCostUsd).toBeCloseTo(1.00, 6);
  });

  it('rejects negative or non-finite numbers', async () => {
    await expect(trackGeminiUsage('tenant-A', -1, 0.10)).rejects.toThrow(/tokens/);
    await expect(trackGeminiUsage('tenant-A', 100, Number.NaN)).rejects.toThrow(/costUsd/);
  });
});

describe('checkQuotaLimit', () => {
  it('returns allowed=true when under tier ceiling', async () => {
    const date = todayUtc();
    await trackGeminiUsage('tenant-A', 100, 0.05, { date });
    const check = await checkQuotaLimit('tenant-A', 'bronze', { date });
    expect(check.allowed).toBe(true);
    expect(check.limit).toBe(100);
  });

  it('blocks when bronze tenant hits 100 daily requests', async () => {
    const date = todayUtc();
    // Pump the counter up to exactly the bronze cap.
    for (let i = 0; i < 100; i += 1) {
      await trackGeminiUsage('tenant-A', 10, 0.001, { date });
    }
    const check = await checkQuotaLimit('tenant-A', 'bronze', { date });
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('requests_exceeded');
    expect(check.usage.geminiRequests).toBe(100);
  });

  it('blocks when bronze tenant exceeds USD ceiling before request count', async () => {
    const date = todayUtc();
    // 5 requests at $1.10 each → $5.50 cost > bronze $5 ceiling (well
    // before the 100-request ceiling).
    for (let i = 0; i < 5; i += 1) {
      await trackGeminiUsage('tenant-A', 10, 1.10, { date });
    }
    const check = await checkQuotaLimit('tenant-A', 'bronze', { date });
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('cost_exceeded');
  });

  it('does not enforce a hard ceiling for diamond tier', async () => {
    const date = todayUtc();
    // 10k requests, each estimated at $1 — well past every other tier
    // ceiling. Diamond should still be allowed.
    for (let i = 0; i < 10; i += 1) {
      await trackGeminiUsage('tenant-A', 1000, 100, { date });
    }
    const check = await checkQuotaLimit('tenant-A', 'diamond', { date });
    expect(check.allowed).toBe(true);
    expect(check.limit).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('resetQuota', () => {
  it('deletes the day quota doc', async () => {
    const date = todayUtc();
    await trackGeminiUsage('tenant-A', 100, 0.01, { date });
    expect(mocks.store.has(`quota_usage/tenant-A__${date}`)).toBe(true);

    await resetQuota('tenant-A', date);
    expect(mocks.store.has(`quota_usage/tenant-A__${date}`)).toBe(false);
    expect(mocks.deleteSpy).toHaveBeenCalledWith(`quota_usage/tenant-A__${date}`);
  });

  it('rejects malformed date strings', async () => {
    await expect(resetQuota('tenant-A', '2026/01/01')).rejects.toThrow(/YYYY-MM-DD/);
  });
});
