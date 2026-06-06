// Praeventio Guard — server-side subscription tier gate (directive #11).
//
// CLAUDE.md #11: "Tier-gating enforcement always lives server-side. Frontend
// gating in SubscriptionContext is UX-only; the canonical rank check is reading
// `users/{uid}.subscription.planId` and comparing against the plan ranks."
//
// This middleware is that canonical server check. Mount it AFTER `verifyAuth`
// (it needs the verified `req.user.uid`) on any route whose feature is gated to
// a paid plan:
//
//   router.post('/sso/config', verifyAuth, requireTier('titanio'), handler);
//
// ⛔ HARD RULE (ADR 0021): NEVER mount requireTier on a LIFE-SAFETY route.
// Life/integrity features — SOS, emergency declaration, ManDown/fall detection,
// lone-worker, evacuation headcount/routes, emergency brigade, DEA/AED,
// incident/hazard reporting, and a worker reading their OWN prevention records —
// are FREE on every tier, including `free`. requireTier is ONLY for
// management/scale/convenience: external integrations (Drive/Workspace, SSO,
// API access), executive dashboard, advanced analytics, custom branding,
// Vertex fine-tuning, multi-tenant. Gating must never reduce a worker's ability
// to stay safe or record what protects them.
// See docs/architecture-decisions/0021-life-safety-features-free-all-tiers.md.
//
// Failure modes:
//   • 401 if there is no authenticated caller (verifyAuth should run first).
//   • 402 Payment Required + { error: 'upgrade_required', requiredPlan,
//     currentPlan } when the caller's plan ranks below `minPlan`.
//   • Fail-CLOSED: if the user doc can't be read (Firestore error), we DENY
//     (403) rather than letting a gated feature through on an unverifiable
//     plan. A missing/unknown plan resolves to the free tier (rank 0).

import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import {
  planMeetsMinimum,
  normalizeSubscriptionPlanId,
  type SubscriptionPlan,
} from '../../services/pricing/subscriptionPlan.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from './captureRouteError.js';

/**
 * Read the caller's authoritative subscription plan from
 * `users/{uid}.subscription.planId` (falling back to the legacy top-level
 * `subscriptionPlan` mirror). Returns `null` only when the lookup THROWS — a
 * doc that simply has no plan resolves to `'free'` upstream via planRank.
 */
async function readCallerPlanId(uid: string): Promise<unknown> {
  const snap = await admin.firestore().collection('users').doc(uid).get();
  if (!snap.exists) return undefined;
  const data = snap.data() ?? {};
  const fromSub = (data.subscription as { planId?: unknown } | undefined)?.planId;
  return fromSub ?? (data as { subscriptionPlan?: unknown }).subscriptionPlan;
}

export function requireTier(minPlan: SubscriptionPlan) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    let planId: unknown;
    try {
      planId = await readCallerPlanId(uid);
    } catch (err) {
      // Fail-closed: we could not verify the plan, so we must NOT serve a
      // paid-gated feature.
      logger.error('require_tier_lookup_failed', err, { uid, minPlan });
      captureRouteError(err, 'requireTier.lookup', { uid });
      res.status(403).json({ error: 'tier_check_failed' });
      return;
    }
    if (!planMeetsMinimum(planId, minPlan)) {
      res.status(402).json({
        error: 'upgrade_required',
        requiredPlan: minPlan,
        currentPlan: normalizeSubscriptionPlanId(planId) ?? 'free',
      });
      return;
    }
    next();
  };
}
