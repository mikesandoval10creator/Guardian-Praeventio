// Praeventio Guard — Audit 2026-Q4 Pilot Entitlement Resolver.
//
// Server-side resolver for closed-beta / pilot entitlements. Adds an
// additional layer on top of the production subscription path so that an
// organization without an active paid invoice can still be granted a
// time-boxed tier (for example 'oro' for 90 days) by an admin grant.
//
// Contract (defended by pilotEntitlementResolver.test.ts):
//
//   1. The resolver is SERVER-SIDE ONLY. It uses firebase-admin, never
//      the client SDK, and reads `organizations/{organizationId}/
//      pilotEntitlements/{pilotId}`.
//   2. Precedence over the production subscription path:
//      a. If `users/{uid}.subscription.planId` is a paid subscription that
//         is still inside its grace window, return that plan (existing
//         behavior — DO NOT regress paid users).
//      b. Else, look up active pilot grants for the organization. The
//         highest-tier grant (by PLAN_RANK) whose [startsAt, endsAt] window
//         contains `now` wins.
//      c. Else, return 'free' (the fail-closed default).
//   3. Pilot grants NEVER escalate a user beyond the production plan they
//      already have. If the user is on 'oro' and the pilot grant is for
//      'plata', the resolver returns 'oro' (paid wins).
//   4. The resolver is TOTAL (never throws). A Firestore outage or a
//      malformed grant doc falls through to 'free' and logs an error.
//   5. The resolver NEVER blocks life-safety actions. `scaleCapsForPlan`
//      already separates management/convenience caps from vida-safety
//      (ADR 0021); this resolver only changes the management-plan rank.
//
// Why this is a separate module from `subscriptionEntitlement.ts`:
// `subscriptionEntitlement.ts` is pure/total and importable from the
// client (no firebase-admin). This resolver must use admin reads, so it
// lives under `src/server/services/` and is mounted from the server-only
// subscription router and the admin router.

import admin from 'firebase-admin';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  PLAN_RANK,
  type SubscriptionPlan,
  normalizeSubscriptionPlanId,
} from '../../services/pricing/subscriptionPlan.js';
import { logger } from '../../utils/logger.js';

// ── Collection shape ────────────────────────────────────────────────────
// Persisted under: organizations/{organizationId}/pilotEntitlements/{pilotId}
//
// The shape is intentionally narrow: it carries only what the resolver and
// the audit log need to make a decision. Cohort metadata (campaign,
// grantedBy, revokeReason) lives here too so admin tooling has one source
// of truth per grant.
export interface PilotEntitlementDoc {
  /** ULID, generated server-side at grant time. Stable across renames. */
  pilotId: string;
  organizationId: string;
  /** Tier granted — one of SUBSCRIPTION_PLANS (free|cobre|plata|oro|...|diamante). */
  grantedTierId: SubscriptionPlan;
  /** RFC 3339 ISO string. Inclusive lower bound. */
  startsAt: string;
  /** RFC 3339 ISO string. Inclusive upper bound. */
  endsAt: string;
  /** Campaign tag, e.g. "pilot-2026-q4", "closed-beta-2027-q1". */
  campaign: string;
  /** Cohort tag, e.g. "cohort-A". Used to slice metrics across cohorts. */
  cohort: string;
  /** Where the grant came from. */
  origin: 'manual_admin' | 'closed_beta_signup' | 'play_store_trial' | 'sales';
  /** Who granted it. */
  grantedBy: { uid: string; email: string | null };
  /** RFC 3339 ISO string. */
  grantedAt: string;
  /** Optional revoke metadata. A revoked doc has status = 'revoked'. */
  revokedAt?: string;
  revokedBy?: { uid: string; email: string | null };
  revokeReason?: string;
  status: 'active' | 'expired' | 'revoked';
}

// ── Resolver input/output ──────────────────────────────────────────────

export interface ResolveEffectivePlanInput {
  uid: string;
  organizationId: string;
  /** Caller-supplied clock. Tests inject a fixed instant. */
  now: Date;
}

export interface ResolveEffectivePlanResult {
  planId: SubscriptionPlan;
  /** Why the resolver chose this plan — useful for telemetry + audit log. */
  reason:
    | 'paid_subscription'
    | 'pilot_grant'
    | 'free_fallback'
    | 'free_no_org';
  /** Populated when reason === 'pilot_grant'. Stable id for telemetry. */
  pilotId?: string;
  /** Populated when reason === 'pilot_grant'. Tier rank observed at resolve time. */
  pilotRank?: number;
  /** Populated when reason === 'paid_subscription'. The verified plan rank. */
  paidRank?: number;
}

// ── Pure helpers (no firebase-admin) ────────────────────────────────────

/**
 * True iff `now` is inside `[startsAt, endsAt]`. Strings are RFC 3339. Pure.
 * `endsAt` is INCLUSIVE — a pilot that ends at 23:59:59.999 Santiago is still
 * valid until the next millisecond. This avoids the off-by-one bug where a
 * user is downgraded a moment before midnight on the last day.
 */
export function isPilotActiveAt(
  startsAt: string,
  endsAt: string,
  now: Date,
): boolean {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const t = now.getTime();
  return t >= start && t <= end;
}

/**
 * Pick the highest-rank active pilot for an org. Returns null when no
 * active pilot matches. Pure (operates on already-fetched docs).
 *
 * Rules:
 *   • status must be 'active'.
 *   • window must contain `now`.
 *   • ties broken by endsAt descending (the grant that lasts the longest wins).
 */
export function pickBestPilot(
  docs: ReadonlyArray<PilotEntitlementDoc>,
  now: Date,
): PilotEntitlementDoc | null {
  let best: PilotEntitlementDoc | null = null;
  let bestRank = -1;
  let bestEnd = -Infinity;
  for (const d of docs) {
    if (d.status !== 'active') continue;
    if (!isPilotActiveAt(d.startsAt, d.endsAt, now)) continue;
    const tier = normalizeSubscriptionPlanId(d.grantedTierId);
    if (!tier) continue;
    const rank = PLAN_RANK[tier];
    if (rank > bestRank || (rank === bestRank && Date.parse(d.endsAt) > bestEnd)) {
      best = d;
      bestRank = rank;
      bestEnd = Date.parse(d.endsAt);
    }
  }
  return best;
}

/**
 * The resolver's precedence rule, in one place: paid wins over pilot if
 * paid rank >= pilot rank. Otherwise pilot wins. Pure.
 */
export function choosePlanByPrecedence(
  paidPlan: SubscriptionPlan | null,
  pilotPlan: SubscriptionPlan | null,
): { planId: SubscriptionPlan; reason: ResolveEffectivePlanResult['reason'] } {
  if (paidPlan) {
    const paidRank = PLAN_RANK[paidPlan];
    if (pilotPlan) {
      const pilotRank = PLAN_RANK[pilotPlan];
      return paidRank >= pilotRank
        ? { planId: paidPlan, reason: 'paid_subscription' }
        : { planId: pilotPlan, reason: 'pilot_grant' };
    }
    return { planId: paidPlan, reason: 'paid_subscription' };
  }
  if (pilotPlan) {
    return { planId: pilotPlan, reason: 'pilot_grant' };
  }
  return { planId: 'free', reason: 'free_fallback' };
}

// ── Server-side resolver (firebase-admin) ───────────────────────────────

export interface PilotResolverDeps {
  /** Injectable for tests; defaults to `admin.firestore()`. */
  firestore?: Firestore;
}

/**
 * Resolve the effective plan for a user within an organization, considering
 * both the production subscription path and any active pilot grants.
 *
 * Failure mode contract: this function NEVER throws. On any error (Firestore
 * outage, malformed doc, missing field), it logs and returns 'free' with the
 * reason explaining why. Callers can render the failure reason in admin
 * tooling but MUST NOT use it as a feature gate.
 */
export async function resolveEffectivePlan(
  input: ResolveEffectivePlanInput,
  deps: PilotResolverDeps = {},
): Promise<ResolveEffectivePlanResult> {
  const fs = deps.firestore ?? admin.firestore();

  // ── Step 1: read the user's subscription doc ────────────────────────
  let paidPlan: SubscriptionPlan | null = null;
  let paidRank = 0;
  try {
    const userSnap = await fs.collection('users').doc(input.uid).get();
    const sub = userSnap.get('subscription');
    if (sub && typeof sub === 'object') {
      const planId = normalizeSubscriptionPlanId((sub as Record<string, unknown>).planId);
      const status = (sub as Record<string, unknown>).status;
      const expiry = (sub as Record<string, unknown>).expiryDate;
      if (planId && isPaidPlanStillValid(planId, status, expiry, input.now)) {
        paidPlan = planId;
        paidRank = PLAN_RANK[planId];
      }
    }
  } catch (err: any) {
    logger.error?.('pilot_resolver.user_read_failed', {
      uid: input.uid,
      message: err?.message,
    });
    // Continue: the user might still have a pilot grant.
  }

  // ── Step 2: read active pilot grants for the org ───────────────────
  let pilotDocs: PilotEntitlementDoc[] = [];
  try {
    const orgRef = fs.collection('organizations').doc(input.organizationId);
    const grantsSnap = await orgRef
      .collection('pilotEntitlements')
      .where('status', '==', 'active')
      .get();
    pilotDocs = grantsSnap.docs
      .map((d: QueryDocumentSnapshot) => coercePilotDoc(d.id, d.data(), input.organizationId))
      .filter((doc): doc is PilotEntitlementDoc => doc !== null);
  } catch (err: any) {
    logger.error?.('pilot_resolver.pilot_read_failed', {
      organizationId: input.organizationId,
      message: err?.message,
    });
    pilotDocs = [];
  }

  // ── Step 3: pick the best pilot + apply precedence ──────────────────
  const bestPilot = pickBestPilot(pilotDocs, input.now);
  const pilotPlan = bestPilot
    ? normalizeSubscriptionPlanId(bestPilot.grantedTierId)
    : null;
  const decision = choosePlanByPrecedence(paidPlan, pilotPlan);

  if (decision.reason === 'pilot_grant' && bestPilot && pilotPlan) {
    return {
      planId: decision.planId,
      reason: decision.reason,
      pilotId: bestPilot.pilotId,
      pilotRank: PLAN_RANK[pilotPlan],
      paidRank: paidRank || undefined,
    };
  }
  if (decision.reason === 'paid_subscription') {
    return {
      planId: decision.planId,
      reason: decision.reason,
      paidRank,
    };
  }
  return {
    planId: 'free',
    reason: paidPlan ? 'paid_subscription' : 'free_fallback',
    paidRank: paidPlan ? paidRank : undefined,
  };
}

/**
 * Coerce an arbitrary Firestore doc into a PilotEntitlementDoc. Returns
 * null on missing required fields. Used by the resolver and by admin
 * tooling that needs to validate a doc shape.
 */
export function coercePilotDoc(
  docId: string,
  raw: FirebaseFirestore.DocumentData | undefined,
  organizationId: string,
): PilotEntitlementDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const tier = normalizeSubscriptionPlanId(raw.grantedTierId);
  if (!tier) return null;
  const startsAt = typeof raw.startsAt === 'string' ? raw.startsAt : null;
  const endsAt = typeof raw.endsAt === 'string' ? raw.endsAt : null;
  if (!startsAt || !endsAt) return null;
  const status = raw.status;
  if (status !== 'active' && status !== 'expired' && status !== 'revoked') return null;
  const grantedBy = raw.grantedBy;
  if (!grantedBy || typeof grantedBy !== 'object') return null;
  const grantedAt = typeof raw.grantedAt === 'string' ? raw.grantedAt : null;
  if (!grantedAt) return null;
  const campaign = typeof raw.campaign === 'string' ? raw.campaign : '';
  const cohort = typeof raw.cohort === 'string' ? raw.cohort : '';
  const origin = raw.origin;
  if (
    origin !== 'manual_admin' &&
    origin !== 'closed_beta_signup' &&
    origin !== 'play_store_trial' &&
    origin !== 'sales'
  ) {
    return null;
  }

  return {
    pilotId: typeof raw.pilotId === 'string' ? raw.pilotId : docId,
    organizationId: typeof raw.organizationId === 'string' ? raw.organizationId : organizationId,
    grantedTierId: tier,
    startsAt,
    endsAt,
    campaign,
    cohort,
    origin,
    grantedBy: {
      uid: typeof grantedBy.uid === 'string' ? grantedBy.uid : 'unknown',
      email: typeof grantedBy.email === 'string' ? grantedBy.email : null,
    },
    grantedAt,
    revokedAt: typeof raw.revokedAt === 'string' ? raw.revokedAt : undefined,
    revokedBy:
      raw.revokedBy && typeof raw.revokedBy === 'object'
        ? {
            uid:
              typeof (raw.revokedBy as Record<string, unknown>).uid === 'string'
                ? ((raw.revokedBy as Record<string, unknown>).uid as string)
                : 'unknown',
            email:
              typeof (raw.revokedBy as Record<string, unknown>).email === 'string'
                ? ((raw.revokedBy as Record<string, unknown>).email as string)
                : null,
          }
        : undefined,
    revokeReason: typeof raw.revokeReason === 'string' ? raw.revokeReason : undefined,
    status,
  };
}

/**
 * Mirror of `subscriptionEntitlement.ts`'s paid-sub validity check, but
 * inline here so this module is self-contained (we don't want a circular
 * import with the client-safe entitlement module). A paid plan is valid
 * when status is one of {active, grace_period} and the expiry is in the
 * future (or absent, for backward compat).
 */
function isPaidPlanStillValid(
  planId: SubscriptionPlan,
  status: unknown,
  expiry: unknown,
  now: Date,
): boolean {
  if (planId === 'free') return false;
  if (status !== 'active' && status !== 'grace_period') return false;
  if (typeof expiry !== 'string') {
    // No expiry at all → treat as still valid (admin manual grant, etc.).
    return true;
  }
  const expiryMs = Date.parse(expiry);
  if (Number.isNaN(expiryMs)) return true;
  return expiryMs >= now.getTime();
}
