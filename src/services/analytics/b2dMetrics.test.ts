/**
 * Praeventio Guard — Bucket CC tests for `b2dMetrics.ts`.
 *
 * Mirrors the in-memory firebase-admin mock pattern from
 * `services/observability/quotaTracker.test.ts`. Tests cover:
 *
 *   1. Empty Firestore → zero metrics.
 *   2. Single active key → MRR = tier price, ARR = 12×MRR.
 *   3. Multi-tier active keys → revenueByTier correctly bucketed.
 *   4. Churn 30d → revoked-after-window key counts as churned.
 *   5. Top customers sorted desc by revenueMonthly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Doc = { id: string; data: any };
  const store = new Map<string, Doc>();

  const collectionFactory = (col: string) => ({
    get: async () => {
      const docs: Array<{ id: string; data: () => any }> = [];
      for (const [path, entry] of store.entries()) {
        if (!path.startsWith(`${col}/`)) continue;
        if (path.split('/').length !== 2) continue;
        docs.push({ id: entry.id, data: () => entry.data });
      }
      return {
        forEach(cb: (d: { id: string; data: () => any }) => void) {
          for (const d of docs) cb(d);
        },
      };
    },
    doc: (id: string) => ({
      set: async (data: any) => {
        store.set(`${col}/${id}`, { id, data });
      },
    }),
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

import { computeB2dMetrics } from './b2dMetrics.js';

const NOW = Date.UTC(2026, 4, 4, 12, 0, 0); // 2026-05-04T12:00:00Z
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

async function seedKey(id: string, doc: Record<string, unknown>): Promise<void> {
  await (mocks.firestoreFactory() as any).collection('b2d_api_keys').doc(id).set(doc);
}

beforeEach(() => {
  mocks.store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('computeB2dMetrics', () => {
  it('returns zeros when there are no API keys', async () => {
    const m = await computeB2dMetrics({ now: NOW });
    expect(m.mrr).toBe(0);
    expect(m.arr).toBe(0);
    expect(m.customersActive).toBe(0);
    expect(m.customersTotal).toBe(0);
    expect(m.churnRate30d).toBe(0);
    expect(m.topCustomers).toEqual([]);
    expect(m.revenueByTier['climate-base']).toBe(0);
  });

  it('reports MRR equal to the tier price for a single active key', async () => {
    await seedKey('k1', {
      customerId: 'cust-1',
      tier: 'climate-base',
      status: 'active',
      createdAt: NOW - 5 * 24 * 60 * 60 * 1000,
    });
    const m = await computeB2dMetrics({ now: NOW });
    // climate-base monthlyUsd = 79
    expect(m.mrr).toBe(79);
    expect(m.arr).toBe(79 * 12);
    expect(m.customersActive).toBe(1);
    expect(m.customersTotal).toBe(1);
    expect(m.revenueByTier['climate-base']).toBe(79);
  });

  it('buckets revenue per tier across multiple active keys', async () => {
    await seedKey('k1', {
      customerId: 'a',
      tier: 'climate-base',
      status: 'active',
      createdAt: NOW - 10 * 24 * 60 * 60 * 1000,
    });
    await seedKey('k2', {
      customerId: 'b',
      tier: 'hazmat-pro',
      status: 'active',
      createdAt: NOW - 10 * 24 * 60 * 60 * 1000,
    });
    await seedKey('k3', {
      customerId: 'c',
      tier: 'suite-pro',
      status: 'active',
      createdAt: NOW - 10 * 24 * 60 * 60 * 1000,
    });

    const m = await computeB2dMetrics({ now: NOW });
    // 79 + 329 + 899 = 1307
    expect(m.mrr).toBe(79 + 329 + 899);
    expect(m.revenueByTier['climate-base']).toBe(79);
    expect(m.revenueByTier['hazmat-pro']).toBe(329);
    expect(m.revenueByTier['suite-pro']).toBe(899);
    expect(m.customersActive).toBe(3);
  });

  it('counts a customer as churned when revoked inside the 30d window', async () => {
    // Customer A: was active 30d ago, revoked 5 days ago → churned.
    await seedKey('k1', {
      customerId: 'cust-A',
      tier: 'climate-base',
      status: 'revoked',
      createdAt: NOW - 60 * 24 * 60 * 60 * 1000,
      revokedAt: NOW - 5 * 24 * 60 * 60 * 1000,
    });
    // Customer B: was active 30d ago, still active → retained.
    await seedKey('k2', {
      customerId: 'cust-B',
      tier: 'hazmat-base',
      status: 'active',
      createdAt: NOW - 90 * 24 * 60 * 60 * 1000,
    });

    const m = await computeB2dMetrics({ now: NOW });
    expect(m.customersActive).toBe(1); // only B
    expect(m.customersTotal).toBe(2);
    // 1 churned out of 2 active 30d ago = 0.5
    expect(m.churnRate30d).toBeCloseTo(0.5, 4);

    // Sanity: a key created INSIDE the window with no revoke is not churn.
    expect(m.mrr).toBe(129); // hazmat-base
  });

  it('orders topCustomers by descending revenueMonthly', async () => {
    await seedKey('k-small', {
      customerId: 'small',
      tier: 'climate-base', // 79
      status: 'active',
      createdAt: NOW - THIRTY_DAYS - 1,
    });
    await seedKey('k-med', {
      customerId: 'med',
      tier: 'normativa-pro', // 399
      status: 'active',
      createdAt: NOW - THIRTY_DAYS - 1,
    });
    await seedKey('k-big-1', {
      customerId: 'big',
      tier: 'suite-pro', // 899
      status: 'active',
      createdAt: NOW - THIRTY_DAYS - 1,
    });
    await seedKey('k-big-2', {
      customerId: 'big',
      tier: 'hazmat-pro', // 329
      status: 'active',
      createdAt: NOW - THIRTY_DAYS - 1,
    });

    const m = await computeB2dMetrics({ now: NOW });
    expect(m.topCustomers.map((c) => c.customerId)).toEqual(['big', 'med', 'small']);
    expect(m.topCustomers[0].revenueMonthly).toBe(899 + 329);
    expect(m.topCustomers[1].revenueMonthly).toBe(399);
    expect(m.topCustomers[2].revenueMonthly).toBe(79);
    // The "tier" we surface for "big" should be the highest-priced one.
    expect(m.topCustomers[0].tier).toBe('suite-pro');
  });
});
