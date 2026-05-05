// Praeventio Guard — Sprint 22 prod hardening (Bucket X).
//
// Per-tenant Gemini quota tracker with daily counters keyed on
// `(tenantId, YYYY-MM-DD)` in Firestore. Closes the cost-explosion
// exposure where a runaway loop or abusive tenant could burn unbounded
// Gemini spend before either the global daily limiter (limiters.ts
// `geminiGlobalDailyLimiter`, 1k req/day across all tenants) or Cloud
// Monitoring caught it.
//
// Layered with:
//   • `geminiCircuit` (server/middleware/geminiCircuit) — fast-fails when
//     Gemini itself is unhealthy, regardless of tenant tier.
//   • `geminiLimiter` (server/middleware/limiters) — per-uid 30 req /
//     15 min express-rate-limit bucket.
//   • This file — per-tenant DAILY ceiling tied to API tier, in cost.
//
// Tier ceilings (matching aiTier.ts shape; the canonical aiTier is
// keyed on B2D API SKUs — `bronze/silver/gold/diamond` here are the
// internal LLM-spend tiers used by the Gemini cost layer, see
// docs/runbooks/QUOTA_RUNBOOK.md):
//
//   • bronze   →   100 req/day,  $5  USD/day
//   • silver   →   500 req/day,  $25 USD/day
//   • gold     →  2000 req/day,  $100 USD/day
//   • diamond  →   unlimited (alert if > $500 USD/day)
//
// Idempotency: `trackGeminiUsage` runs inside a Firestore transaction so
// retries by upstream (e.g. Express auto-retry, Sentry rehydration) do
// not double-count usage as long as the caller passes the same
// `idempotencyKey`. When omitted, the tracker only ensures atomic
// increments — caller is responsible for at-most-once semantics.

import * as admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

/** Tier identifiers used by the Gemini-cost ceiling layer. */
export type QuotaTier = 'bronze' | 'silver' | 'gold' | 'diamond';

export interface QuotaUsage {
  tenantId: string;
  /** UTC date in YYYY-MM-DD form. */
  date: string;
  geminiTokens: number;
  geminiRequests: number;
  geminiCostUsd: number;
}

export interface QuotaCheck {
  allowed: boolean;
  usage: QuotaUsage;
  /** Daily request limit for the tier (Infinity for diamond). */
  limit: number;
  /** When `allowed=false`, a short slug describing why. */
  reason?: 'requests_exceeded' | 'cost_exceeded';
}

/** Daily ceiling per tier (requests + USD cost). */
interface TierCeiling {
  requestsPerDay: number;
  costUsdPerDay: number;
}

const TIER_CEILINGS: Record<QuotaTier, TierCeiling> = {
  bronze: { requestsPerDay: 100, costUsdPerDay: 5 },
  silver: { requestsPerDay: 500, costUsdPerDay: 25 },
  gold: { requestsPerDay: 2000, costUsdPerDay: 100 },
  // Diamond is "unlimited" — but we still surface a soft alert threshold
  // so cost overruns are visible to ops. Hard ceiling stays Infinity.
  diamond: { requestsPerDay: Number.POSITIVE_INFINITY, costUsdPerDay: Number.POSITIVE_INFINITY },
};

/** Soft alert threshold for diamond tier (USD/day) — see runbook. */
export const DIAMOND_ALERT_THRESHOLD_USD = 500;

const COLLECTION = 'quota_usage';
const IDEMPOTENCY_SUBCOLLECTION = 'idempotency';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Returns today's UTC date in YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Stable doc id for `(tenantId, date)`. Sanitized to be Firestore-safe. */
function quotaDocId(tenantId: string, date: string): string {
  // Firestore doc ids cannot contain `/` and must not be `.` or `..`.
  // Tenant ids in this codebase are firestore uids / org ids
  // (alphanumeric + `_` + `-`); date is YYYY-MM-DD. We compose them with
  // `__` so we can recover the parts in admin tooling if ever needed.
  return `${tenantId}__${date}`;
}

function emptyUsage(tenantId: string, date: string): QuotaUsage {
  return {
    tenantId,
    date,
    geminiTokens: 0,
    geminiRequests: 0,
    geminiCostUsd: 0,
  };
}

function isQuotaTier(value: unknown): value is QuotaTier {
  return value === 'bronze' || value === 'silver' || value === 'gold' || value === 'diamond';
}

/**
 * Map an arbitrary tier string to a QuotaTier. Unknown tiers fall back
 * to `bronze` (the safest default — tightest ceiling). Callers that
 * already validated their tier upstream can pass a `QuotaTier` directly.
 */
export function normalizeTier(tier: string | null | undefined): QuotaTier {
  if (isQuotaTier(tier)) return tier;
  // The aiTier B2D SKUs (`*-pro` / `suite-pro`) get gold treatment;
  // `*-base` / `suite-base` get silver. Anything else (or null) falls
  // back to bronze.
  if (typeof tier === 'string') {
    if (tier === 'suite-pro' || tier.endsWith('-pro')) return 'gold';
    if (tier === 'suite-base' || tier.endsWith('-base')) return 'silver';
  }
  return 'bronze';
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Increment Gemini usage counters for `(tenantId, todayUtc)`.
 *
 * Always atomic: runs inside a Firestore transaction. When
 * `idempotencyKey` is supplied, the function records the key in a
 * sub-document so retries with the same key are no-ops (returns the
 * pre-existing usage row unchanged).
 *
 * The estimated USD cost should already be computed by the caller —
 * the tracker is intentionally cost-model-agnostic so Gemini pricing
 * changes don't cascade through this file.
 */
export async function trackGeminiUsage(
  tenantId: string,
  tokens: number,
  costUsd: number,
  options: { date?: string; requests?: number; idempotencyKey?: string } = {},
): Promise<QuotaUsage> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new TypeError('quotaTracker.trackGeminiUsage: tenantId required');
  }
  if (!Number.isFinite(tokens) || tokens < 0) {
    throw new RangeError('quotaTracker.trackGeminiUsage: tokens must be finite >= 0');
  }
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new RangeError('quotaTracker.trackGeminiUsage: costUsd must be finite >= 0');
  }

  const date = options.date ?? todayUtc();
  const requests = options.requests ?? 1;
  const docId = quotaDocId(tenantId, date);
  const db = admin.firestore();
  const docRef = db.collection(COLLECTION).doc(docId);

  const result = await db.runTransaction(async (tx) => {
    // Idempotency check first — avoids double-counting on retry.
    if (options.idempotencyKey) {
      const idemRef = docRef.collection(IDEMPOTENCY_SUBCOLLECTION).doc(options.idempotencyKey);
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) {
        const snap = await tx.get(docRef);
        const data = (snap.exists ? (snap.data() as Partial<QuotaUsage>) : {}) ?? {};
        return {
          tenantId,
          date,
          geminiTokens: data.geminiTokens ?? 0,
          geminiRequests: data.geminiRequests ?? 0,
          geminiCostUsd: data.geminiCostUsd ?? 0,
        };
      }
      // Mark idempotency key consumed BEFORE incrementing.
      tx.set(idemRef, {
        consumedAt: admin.firestore.FieldValue.serverTimestamp(),
        tokens,
        costUsd,
        requests,
      });
    }

    const snap = await tx.get(docRef);
    const previous: Partial<QuotaUsage> = snap.exists ? (snap.data() as Partial<QuotaUsage>) : {};
    const next: QuotaUsage = {
      tenantId,
      date,
      geminiTokens: (previous.geminiTokens ?? 0) + tokens,
      geminiRequests: (previous.geminiRequests ?? 0) + requests,
      geminiCostUsd:
        Math.round(((previous.geminiCostUsd ?? 0) + costUsd) * 1_000_000) / 1_000_000,
    };

    if (snap.exists) {
      tx.update(docRef, {
        geminiTokens: next.geminiTokens,
        geminiRequests: next.geminiRequests,
        geminiCostUsd: next.geminiCostUsd,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(docRef, {
        ...next,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return next;
  });

  // Diamond soft-alert: surface a warn log when cost crosses threshold.
  // Caller decides what to do with it; ops dashboards filter on this slug.
  if (result.geminiCostUsd >= DIAMOND_ALERT_THRESHOLD_USD) {
    logger.warn('[quota.diamond_alert] tenant exceeded soft cost threshold', {
      tenantId,
      date,
      geminiCostUsd: result.geminiCostUsd,
      thresholdUsd: DIAMOND_ALERT_THRESHOLD_USD,
    });
  }

  return result;
}

/**
 * Check whether a tenant is allowed to make another Gemini request
 * today. Pure read — does not mutate state.
 */
export async function checkQuotaLimit(
  tenantId: string,
  tier: string,
  options: { date?: string } = {},
): Promise<QuotaCheck> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new TypeError('quotaTracker.checkQuotaLimit: tenantId required');
  }

  const date = options.date ?? todayUtc();
  const normalizedTier = normalizeTier(tier);
  const ceiling = TIER_CEILINGS[normalizedTier];

  const docRef = admin.firestore().collection(COLLECTION).doc(quotaDocId(tenantId, date));
  const snap = await docRef.get();
  const usage: QuotaUsage = snap.exists
    ? {
        tenantId,
        date,
        geminiTokens: (snap.data() as Partial<QuotaUsage>)?.geminiTokens ?? 0,
        geminiRequests: (snap.data() as Partial<QuotaUsage>)?.geminiRequests ?? 0,
        geminiCostUsd: (snap.data() as Partial<QuotaUsage>)?.geminiCostUsd ?? 0,
      }
    : emptyUsage(tenantId, date);

  // Diamond → no hard ceiling, only soft alert (logged in trackGeminiUsage).
  if (!Number.isFinite(ceiling.requestsPerDay)) {
    return { allowed: true, usage, limit: Number.POSITIVE_INFINITY };
  }

  if (usage.geminiRequests >= ceiling.requestsPerDay) {
    return {
      allowed: false,
      usage,
      limit: ceiling.requestsPerDay,
      reason: 'requests_exceeded',
    };
  }
  if (usage.geminiCostUsd >= ceiling.costUsdPerDay) {
    return {
      allowed: false,
      usage,
      limit: ceiling.requestsPerDay,
      reason: 'cost_exceeded',
    };
  }
  return { allowed: true, usage, limit: ceiling.requestsPerDay };
}

/**
 * Reset (delete) a tenant's daily quota row. Admin-only. Use with care
 * — cancels the day's accounting entirely. Logs a warn so audit trails
 * surface manual interventions.
 */
export async function resetQuota(tenantId: string, date: string): Promise<void> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new TypeError('quotaTracker.resetQuota: tenantId required');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('quotaTracker.resetQuota: date must be YYYY-MM-DD');
  }
  const docRef = admin.firestore().collection(COLLECTION).doc(quotaDocId(tenantId, date));
  await docRef.delete();
  logger.warn('[quota.reset] tenant quota manually reset', { tenantId, date });
}

/**
 * Get current usage for a tenant on a given date (default today UTC).
 * Returns zeroed counters when no row exists.
 */
export async function getUsage(tenantId: string, date?: string): Promise<QuotaUsage> {
  const day = date ?? todayUtc();
  const docRef = admin.firestore().collection(COLLECTION).doc(quotaDocId(tenantId, day));
  const snap = await docRef.get();
  if (!snap.exists) return emptyUsage(tenantId, day);
  const data = snap.data() as Partial<QuotaUsage>;
  return {
    tenantId,
    date: day,
    geminiTokens: data.geminiTokens ?? 0,
    geminiRequests: data.geminiRequests ?? 0,
    geminiCostUsd: data.geminiCostUsd ?? 0,
  };
}

/**
 * Top-N tenants by spend today (ops dashboard support). Reads at most
 * `limit` rows for `date` and returns them sorted by descending USD.
 * Falls back to descending requests when costs are equal.
 */
export async function topTenantsByUsage(
  date: string,
  limit = 10,
): Promise<QuotaUsage[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('quotaTracker.topTenantsByUsage: date must be YYYY-MM-DD');
  }
  const snap = await admin
    .firestore()
    .collection(COLLECTION)
    .where('date', '==', date)
    .orderBy('geminiCostUsd', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => {
    const data = doc.data() as Partial<QuotaUsage>;
    return {
      tenantId: data.tenantId ?? '',
      date,
      geminiTokens: data.geminiTokens ?? 0,
      geminiRequests: data.geminiRequests ?? 0,
      geminiCostUsd: data.geminiCostUsd ?? 0,
    };
  });
}

/** Exposed for tests + admin tooling. Do not use in hot paths. */
export const __internals = {
  TIER_CEILINGS,
  quotaDocId,
  COLLECTION,
};
