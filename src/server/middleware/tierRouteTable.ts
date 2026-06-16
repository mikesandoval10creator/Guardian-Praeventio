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
// Life-safety KEYWORDS (ADR 0021) — a gated mount whose path contains any of
// these names a FREE-for-all feature and must never be gated. We match on
// keywords rather than exact mount prefixes because life-safety routers are
// mounted at varied prefixes (several live under `/api/sprint-k/:projectId/...`
// alongside paid analytics; others are top-level) — a hand-maintained prefix
// list drifts out of sync with server.ts and silently lets a future violation
// through (the failure mode flagged in review of this PR). This mirrors the
// proven keyword scan in `tierGatingGovernance.test.ts`
// (LIFE_SAFETY_PATH_PATTERNS), keeping both safety nets consistent.
//
// Erring toward "cannot gate" is the correct ADR-0021 default: incident/
// emergency analytics that happen to share a keyword stay free unless
// explicitly refactored — a risk-prevention app must never paywall a life
// action.
export const LIFE_SAFETY_KEYWORDS: readonly string[] = [
  'emergency',
  'evacuat',
  'brigade',
  'lone-worker',
  'loneworker',
  'incident',
  'sos',
  'man-down',
  'mandown',
  'fall',
  '/dea',
  'survival',
  'ping',
  'rescue',
  'panic',
  'first-responder',
  'firstresponder',
  'portable-history',
  '/sif',
  'commute',
];

/** True iff a mount path names a life-safety feature (case-insensitive). */
export function isLifeSafetyMount(mount: string): boolean {
  const lower = mount.toLowerCase();
  return LIFE_SAFETY_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * ADR-0021 invariant: NO tier-gated route may name a life-safety feature.
 * Throws (fail-loud) so a mis-edit that would gate an emergency feature crashes
 * boot / CI rather than silently denying a worker a life-saving action.
 */
export function assertNoLifeSafetyInTable(): void {
  for (const entry of TIER_ROUTE_TABLE) {
    const hit = LIFE_SAFETY_KEYWORDS.find((kw) => entry.mount.toLowerCase().includes(kw));
    if (hit) {
      throw new Error(
        `ADR 0021 violation: tier-gated route "${entry.mount}" (${entry.feature}) ` +
          `names life-safety keyword "${hit}" — life features are FREE on every tier.`,
      );
    }
  }
}

/**
 * Deploy-time rollout flag (TIER-GATING-SERVER-SIDE-SPEC.md §4). Default
 * REPORT-ONLY: gated mounts log `tier_gate_would_block` but serve the request,
 * so a mis-indexed paid customer is never denied during validation. Flip
 * `TIER_GATE_ENFORCE=true` to hard-block (402) once logs confirm the table.
 *
 * Read at route-registration time (module load), so flipping the flag requires
 * a REDEPLOY/restart — not a live env mutation. On Cloud Run (immutable
 * revisions) this is automatic; document it for any other runtime.
 */
export function tierGateEnforced(): boolean {
  return process.env.TIER_GATE_ENFORCE === 'true';
}

// Fail-loud at module load: a table that gates a life route must never boot.
assertNoLifeSafetyInTable();
