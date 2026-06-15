// Praeventio Guard — server-side SCALE caps (worker-seat / project limits).
//
// The pricing model monetizes by SCALE: each plan caps how many workers (app
// seats) and projects a tenant may have. The CLIENT estimates this in
// `calculateMonthlyCost` (tiers.ts), but — like all tier-gating (CLAUDE.md
// #11) — the canonical check must live SERVER-side. This module is the pure,
// deterministic core of that server check: given a caller's authoritative plan
// (`users/{uid}.subscription.planId`) it returns the seat/project caps and
// evaluates whether a projected count stays within them.
//
// It NEVER blocks on its own — callers decide. Phase 1 (report-only) callers
// just log `tier_gate_would_block`; Phase 2 (enforce) callers return 402.
// See docs/security/TIER-GATING-SERVER-SIDE-SPEC.md.
//
// ⛔ ADR 0021: scale caps are MANAGEMENT/convenience limits. They must NEVER
// gate a life-safety action (SOS, emergency, ManDown, evacuation, or a worker
// recording their own prevention data). Adding a teammate to a project is a
// management action, so it is a valid cap target; declaring an emergency is not.

import { TIERS } from './tiers.js';
import {
  TIER_TO_SUBSCRIPTION_PLAN,
  normalizeSubscriptionPlanId,
  type SubscriptionPlan,
} from './subscriptionPlan.js';

export interface ScaleCaps {
  /** Max app-seat workers (project members) allowed under this plan. */
  trabajadoresMax: number;
  /** Max simultaneous active projects allowed under this plan. */
  proyectosMax: number;
}

/**
 * Seat/project caps for an authoritative subscription plan.
 *
 * A plan can map from MORE THAN ONE tier (e.g. both `ilimitado` and
 * `global-titanio` resolve to the `ilimitado` plan). We take the MAX cap across
 * those tiers so a paid plan is never UNDER-reported — a generous cap can only
 * fail to flag, never falsely block a paying customer.
 *
 * An unknown / missing plan fails CLOSED to the `free` plan via
 * `normalizeSubscriptionPlanId`, matching `requireTier`'s posture.
 */
/** MAX caps across every tier that maps to `normalized` (0/0 if none map). */
function capsForNormalizedPlan(normalized: SubscriptionPlan): ScaleCaps {
  let trabajadoresMax = 0;
  let proyectosMax = 0;
  for (const tier of TIERS) {
    if (TIER_TO_SUBSCRIPTION_PLAN[tier.id] !== normalized) continue;
    trabajadoresMax = Math.max(trabajadoresMax, tier.trabajadoresMax);
    proyectosMax = Math.max(proyectosMax, tier.proyectosMax);
  }
  return { trabajadoresMax, proyectosMax };
}

/** Free-plan caps, the fail-closed floor (gratis tier → 10 / 1). */
const FREE_CAPS: ScaleCaps = capsForNormalizedPlan('free');

export function scaleCapsForPlan(plan: unknown): ScaleCaps {
  const normalized = normalizeSubscriptionPlanId(plan) ?? 'free';
  const caps = capsForNormalizedPlan(normalized);
  // A recognized plan with NO tier mapping is a misconfiguration (a plan added
  // to SUBSCRIPTION_PLANS without a TIERS row). Fail CLOSED to the free caps
  // rather than return {0,0} — which would log every action as over-cap in
  // Fase 1 and BLOCK every action in Fase 2. The "every plan resolves to caps
  // > 0" test (scaleCaps.test.ts) prevents this from ever shipping.
  if (caps.trabajadoresMax === 0 && caps.proyectosMax === 0) return { ...FREE_CAPS };
  return caps;
}

export type ScaleKind = 'workers' | 'projects';

export interface ScaleCapDecision {
  kind: ScaleKind;
  /** The normalized plan the caps were derived from. */
  plan: SubscriptionPlan;
  /** The cap for `kind` under `plan`. */
  cap: number;
  /** Count before the pending addition (clamped to ≥0). */
  current: number;
  /** `current` + `delta` — the count if the action proceeds. */
  projected: number;
  /** True iff `projected` stays within `cap`. */
  withinCap: boolean;
}

/**
 * Evaluate whether adding `delta` (default 1) item(s) of `kind` keeps a tenant
 * within its plan's cap. Pure — the caller decides what to DO with a
 * `withinCap: false` result (log in report-only mode, or 402 in enforce mode).
 */
export function evaluateScaleCap(args: {
  plan: unknown;
  kind: ScaleKind;
  current: number;
  delta?: number;
}): ScaleCapDecision {
  const plan = normalizeSubscriptionPlanId(args.plan) ?? 'free';
  const caps = scaleCapsForPlan(plan);
  const cap = args.kind === 'workers' ? caps.trabajadoresMax : caps.proyectosMax;
  const current = Math.max(0, args.current);
  // Clamp delta to ≥0: a negative/non-finite delta must never make `projected`
  // smaller than `current` (which would let a caller "subtract past" the cap in
  // enforce mode). `undefined` means the default single-item add.
  const rawDelta = args.delta ?? 1;
  const delta = Number.isFinite(rawDelta) ? Math.max(0, rawDelta) : 1;
  const projected = current + delta;
  return { kind: args.kind, plan, cap, current, projected, withinCap: projected <= cap };
}
