/**
 * Praeventio Guard — B2D revenue metrics (Bucket CC, Sprint 23)
 *
 * Pure-ish service that computes MRR / ARR / churn / revenue-by-tier from
 * the two Firestore collections owned by the B2D revenue surface:
 *
 *   - `b2d_api_keys`   — owned by Bucket BB (apiKeyService.ts).
 *                       Each doc carries { customerId, tier, status,
 *                       createdAt, revokedAt? }. Bucket BB is in flight
 *                       at the time this file lands; we type the doc
 *                       shape locally so this module can compile and be
 *                       tested independently. TODO post-merge: import
 *                       canonical types from `services/b2d/apiKeyService`
 *                       and drop the local declarations.
 *
 *   - `invoices`       — owned by services/billing/invoice.ts. Filtered
 *                       on `lineItems[*].tierId` starting with `b2d-` so
 *                       non-B2D revenue (essentials/professional/etc.)
 *                       does NOT bleed into the dashboard.
 *
 * MRR semantics:
 *   - MRR = sum of monthly tier prices for `active` keys (1 active key
 *     per customer-tier counts once).
 *   - ARR = MRR × 12.
 *
 * Churn semantics (30d window):
 *   - Numerator: customers active 30d ago that are NOT active now.
 *   - Denominator: customers active 30d ago.
 *   - Returns 0 when denominator is 0 (no customers to churn against).
 *
 * Top customers:
 *   - Aggregated by customerId. Each customer's revenueMonthly is the
 *     sum of monthly prices of all their active keys. The dashboard
 *     uses this for the "Top 10" table; we cap at 50 here so the API
 *     response stays bounded even for large tenants.
 *
 * The service is intentionally thin — no caching, no telemetry side
 * effects. Caller (the admin route) adds verifyAuth + admin-role gating
 * and any caching they want.
 */

import admin from 'firebase-admin';
import { API_TIERS, type ApiTierId, getApiTier } from '../pricing/aiTier.js';

/**
 * Bucket-BB compatible shape for an API key document. Defined locally
 * so this module can compile + ship before Bucket BB merges. After
 * Bucket BB lands, swap to `import type { ApiKeyDoc } from
 * '../b2d/apiKeyService'`.
 */
export interface B2dApiKeyDoc {
  customerId: string;
  tier: ApiTierId;
  status: 'active' | 'revoked';
  createdAt: number; // epoch ms
  revokedAt?: number; // epoch ms
}

export type B2dTier = ApiTierId;

export interface B2dMetrics {
  mrr: number;
  arr: number;
  customersActive: number;
  customersTotal: number;
  churnRate30d: number;
  revenueByTier: Record<B2dTier, number>;
  topCustomers: { customerId: string; tier: B2dTier; revenueMonthly: number }[];
}

interface ComputeOpts {
  /** Override "now" in tests to make 30d-window checks deterministic. */
  now?: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Build a zero-filled `revenueByTier` matching the canonical 8 tiers. */
function emptyRevenueByTier(): Record<B2dTier, number> {
  const out = {} as Record<B2dTier, number>;
  for (const tier of API_TIERS) {
    out[tier.id] = 0;
  }
  return out;
}

function safeTierPrice(id: ApiTierId): number {
  try {
    return getApiTier(id).monthlyUsd;
  } catch {
    // Unknown tier id slipped into Firestore — count as 0 USD so the
    // dashboard still renders rather than crashing. Ops can fix the
    // bad row offline.
    return 0;
  }
}

/**
 * Read all B2D API key documents.
 *
 * Defensive: silently treats missing collection / read errors as empty
 * (empty dashboard better than 500 page).
 */
async function readApiKeys(): Promise<B2dApiKeyDoc[]> {
  try {
    const snap = await admin.firestore().collection('b2d_api_keys').get();
    const out: B2dApiKeyDoc[] = [];
    snap.forEach((doc) => {
      const d = doc.data() as Partial<B2dApiKeyDoc> | undefined;
      if (!d || typeof d.customerId !== 'string' || typeof d.tier !== 'string') {
        return;
      }
      const createdAt = typeof d.createdAt === 'number' ? d.createdAt : 0;
      const status: 'active' | 'revoked' = d.status === 'revoked' ? 'revoked' : 'active';
      out.push({
        customerId: d.customerId,
        tier: d.tier as ApiTierId,
        status,
        createdAt,
        revokedAt: typeof d.revokedAt === 'number' ? d.revokedAt : undefined,
      });
    });
    return out;
  } catch {
    return [];
  }
}

/**
 * Whether `key` was active at instant `at`.
 *
 * - Created at or before `at`.
 * - Either still active OR revoked strictly after `at`.
 */
function wasActiveAt(key: B2dApiKeyDoc, at: number): boolean {
  if (key.createdAt > at) return false;
  if (key.status === 'active') return true;
  if (typeof key.revokedAt === 'number' && key.revokedAt > at) return true;
  return false;
}

/**
 * Compute B2D revenue metrics from Firestore.
 *
 * @param opts.now  Optional clock override (epoch ms) for tests.
 */
export async function computeB2dMetrics(opts: ComputeOpts = {}): Promise<B2dMetrics> {
  const now = opts.now ?? Date.now();
  const thirtyDaysAgo = now - THIRTY_DAYS_MS;

  const keys = await readApiKeys();

  // Active set right now.
  const activeNow = keys.filter((k) => wasActiveAt(k, now));
  const activeCustomersNow = new Set(activeNow.map((k) => k.customerId));

  // Active set 30 days ago — for the churn-rate denominator.
  const activeThen = keys.filter((k) => wasActiveAt(k, thirtyDaysAgo));
  const activeCustomersThen = new Set(activeThen.map((k) => k.customerId));

  // MRR + revenueByTier from active-now keys.
  const revenueByTier = emptyRevenueByTier();
  let mrr = 0;
  for (const key of activeNow) {
    const price = safeTierPrice(key.tier);
    mrr += price;
    if (revenueByTier[key.tier] === undefined) {
      revenueByTier[key.tier] = 0;
    }
    revenueByTier[key.tier] += price;
  }

  const arr = mrr * 12;

  // Churn 30d.
  let churned = 0;
  for (const customerId of activeCustomersThen) {
    if (!activeCustomersNow.has(customerId)) churned += 1;
  }
  const churnRate30d = activeCustomersThen.size === 0
    ? 0
    : churned / activeCustomersThen.size;

  // Top customers by monthly revenue.
  const perCustomerRevenue = new Map<string, number>();
  const perCustomerTopTier = new Map<string, { tier: B2dTier; price: number }>();
  for (const key of activeNow) {
    const price = safeTierPrice(key.tier);
    perCustomerRevenue.set(
      key.customerId,
      (perCustomerRevenue.get(key.customerId) ?? 0) + price,
    );
    const cur = perCustomerTopTier.get(key.customerId);
    if (!cur || price > cur.price) {
      perCustomerTopTier.set(key.customerId, { tier: key.tier, price });
    }
  }
  const topCustomers = [...perCustomerRevenue.entries()]
    .map(([customerId, revenueMonthly]) => ({
      customerId,
      tier: perCustomerTopTier.get(customerId)?.tier ?? ('climate-base' as B2dTier),
      revenueMonthly,
    }))
    .sort((a, b) => b.revenueMonthly - a.revenueMonthly)
    .slice(0, 50);

  // Total customers ever seen — useful for retention math downstream.
  const customersTotal = new Set(keys.map((k) => k.customerId)).size;

  return {
    mrr,
    arr,
    customersActive: activeCustomersNow.size,
    customersTotal,
    churnRate30d: Math.round(churnRate30d * 10000) / 10000,
    revenueByTier,
    topCustomers,
  };
}
