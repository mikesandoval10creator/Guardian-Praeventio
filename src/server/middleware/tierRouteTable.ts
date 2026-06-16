// Praeventio Guard — central tier-gating policy (TIER-GATING-SERVER-SIDE-SPEC.md).
//
// SINGLE SOURCE OF TRUTH for which server routes are gated to a paid plan,
// mirroring the client feature matrix in `SubscriptionContext.getFeaturesForPlan`.
// The gate itself is applied per-router via `requireTier` (which must run AFTER
// `verifyAuth`); this table documents the policy in one place and powers the
// ADR-0021 life-safety invariant test below.
//
// ⛔ ADR 0021: LIFE-SAFETY routes (SOS, emergency, ManDown, lone-worker,
// evacuation, brigade, DEA, incident/hazard reporting, survival ping, and a
// worker reading their OWN prevention records) are FREE on EVERY tier and MUST
// NEVER appear here. `assertNoLifeSafetyInTable()` enforces that at module load
// and in CI. Tier-gating is ONLY for management/scale/convenience.

import type { SubscriptionPlan } from '../../services/pricing/subscriptionPlan.js';

export interface TierRouteEntry {
  /** API mount prefix the gate guards (`*` = a path-param segment). */
  mount: string;
  /** Minimum plan required — mirrors the client `getFeaturesForPlan` matrix. */
  minPlan: SubscriptionPlan;
  /** The premium feature this corresponds to (telemetry / docs). */
  feature: string;
}

// Mirrors SubscriptionContext.getFeaturesForPlan (the client UX matrix):
//   executive dashboard → oro · SSO/Workspace → titanio · advanced analytics,
//   custom branding, Vertex fine-tune, API access, multi-tenant → platino.
export const TIER_ROUTE_TABLE: readonly TierRouteEntry[] = [
  { mount: '/api/insights', minPlan: 'platino', feature: 'advanced_analytics' },
  { mount: '/api/sprint-k/*/multi-project', minPlan: 'platino', feature: 'multi_tenant_portfolio' },
  { mount: '/api/sprint-k/*/maturity-index', minPlan: 'platino', feature: 'advanced_analytics' },
  { mount: '/api/sprint-k/*/role-summary', minPlan: 'platino', feature: 'advanced_analytics' },
  { mount: '/api/drive', minPlan: 'titanio', feature: 'google_workspace_addon' },
  { mount: '/api/auth/google', minPlan: 'titanio', feature: 'sso' },
] as const;

// Life-safety mount prefixes (ADR 0021) — FREE for all tiers, never gated.
// `/*` marks a path-param segment so we don't false-collide on the shared
// `/api/sprint-k` prefix (portable-history is a worker's OWN record = free,
// multi-project is a paid analytics surface — both live under sprint-k).
export const LIFE_SAFETY_MOUNTS: readonly string[] = [
  '/api/emergency',
  '/api/incidents',
  '/api/sos',
  '/api/mandown',
  '/api/lone-worker',
  '/api/evacuation',
  '/api/brigade',
  '/api/dea',
  '/api/pings',
  '/api/survival',
  '/api/commute',
  '/api/mesh',
  '/api/cad',
  '/api/sprint-k/*/portable-history',
];

function segments(mount: string): string[] {
  return mount.split('/').filter(Boolean);
}

function segmentMatches(a: string, b: string): boolean {
  return a === b || a === '*' || b === '*';
}

/**
 * True iff one mount is a path-segment prefix of the other (treating `*` as a
 * wildcard segment) — i.e. requests to one could reach the other.
 */
export function mountsOverlap(a: string, b: string): boolean {
  const sa = segments(a);
  const sb = segments(b);
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    if (!segmentMatches(sa[i], sb[i])) return false;
  }
  return true;
}

/**
 * ADR-0021 invariant: NO tier-gated route may overlap a life-safety mount.
 * Throws (fail-loud) so a mis-edit that would gate an emergency feature crashes
 * boot / CI rather than silently denying a worker a life-saving action.
 */
export function assertNoLifeSafetyInTable(): void {
  for (const entry of TIER_ROUTE_TABLE) {
    for (const life of LIFE_SAFETY_MOUNTS) {
      if (mountsOverlap(entry.mount, life)) {
        throw new Error(
          `ADR 0021 violation: tier-gated route "${entry.mount}" (${entry.feature}) ` +
            `overlaps life-safety mount "${life}" — life features are FREE on every tier.`,
        );
      }
    }
  }
}

/**
 * Deploy-time rollout flag (TIER-GATING-SERVER-SIDE-SPEC.md §4). Default
 * REPORT-ONLY: gated mounts log `tier_gate_would_block` but serve the request,
 * so a mis-indexed paid customer is never denied during validation. Flip
 * `TIER_GATE_ENFORCE=true` to hard-block (402) once logs confirm the table.
 */
export function tierGateEnforced(): boolean {
  return process.env.TIER_GATE_ENFORCE === 'true';
}

// Fail-loud at module load: a table that gates a life route must never boot.
assertNoLifeSafetyInTable();
