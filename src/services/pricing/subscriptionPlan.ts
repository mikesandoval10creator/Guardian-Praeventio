import type { TierId } from './tiers';

export const SUBSCRIPTION_PLANS = [
  'free',
  'cobre',
  'plata',
  'oro',
  'titanio',
  'platino',
  'diamante',
] as const;

export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const TIER_TO_SUBSCRIPTION_PLAN: Record<TierId, SubscriptionPlan> = {
  gratis: 'free',
  cobre: 'cobre',
  plata: 'plata',
  oro: 'oro',
  titanio: 'titanio',
  platino: 'platino',
  diamante: 'diamante',
};

const SUBSCRIPTION_PLAN_SET: ReadonlySet<string> = new Set(SUBSCRIPTION_PLANS);

// Legacy aliases — map the PRE-collapse (2026-06-15) tier ids + plan names onto
// the 7-metal scheme so any stale string (old Firestore value, old test, old
// link) normalizes cleanly. closest-capacity-UP, never downgrade:
//   comité/comite-paritario → Plata (CPHS band)
//   departamento(-prevencion) → Oro (DPRP band)
//   empresarial/corporativo → Platino (enterprise band)
//   ilimitado/global-titanio → Diamante (unlimited + global)
const LEGACY_ALIASES: Record<string, SubscriptionPlan> = {
  premium: 'oro',
  basic: 'cobre',
  comite: 'plata',
  'comite-paritario': 'plata',
  departamento: 'oro',
  'departamento-prevencion': 'oro',
  empresarial: 'platino',
  corporativo: 'platino',
  ilimitado: 'diamante',
  'global-titanio': 'diamante',
};

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === 'string' && SUBSCRIPTION_PLAN_SET.has(value);
}

export function subscriptionPlanForPaidTier(tierId: unknown): SubscriptionPlan | null {
  return typeof tierId === 'string'
    ? TIER_TO_SUBSCRIPTION_PLAN[tierId as TierId] ?? null
    : null;
}

export function normalizeSubscriptionPlanId(value: unknown): SubscriptionPlan | null {
  if (typeof value !== 'string') return null;
  if (isSubscriptionPlan(value)) return value;
  return LEGACY_ALIASES[value] ?? subscriptionPlanForPaidTier(value);
}

export function subscriptionPlanMatchesPaidTier(
  requestedPlan: SubscriptionPlan,
  paidTierId: unknown,
): boolean {
  return normalizeSubscriptionPlanId(paidTierId) === requestedPlan;
}

/**
 * Canonical plan ranking, lowest (free) → highest (diamante). SINGLE SOURCE OF
 * TRUTH for tier comparisons, used by BOTH the client feature matrix
 * (`SubscriptionContext`) and the SERVER enforcement middleware
 * (`requireTier`). Tier-gating is UX-only on the client (directive #11) — the
 * authoritative check reads `users/{uid}.subscription.planId` server-side and
 * compares ranks here.
 */
export const PLAN_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  cobre: 1,
  plata: 2,
  oro: 3,
  titanio: 4,
  platino: 5,
  diamante: 6,
};

/**
 * Rank for an arbitrary (possibly legacy/unknown) plan value. Unknown or
 * missing values resolve to the free-tier rank (0) — fail-closed: an
 * unrecognized plan never satisfies a paid gate.
 */
export function planRank(plan: unknown): number {
  const normalized = normalizeSubscriptionPlanId(plan);
  return normalized ? PLAN_RANK[normalized] : 0;
}

/** True iff `plan` ranks at or above `minPlan`. */
export function planMeetsMinimum(plan: unknown, minPlan: SubscriptionPlan): boolean {
  return planRank(plan) >= PLAN_RANK[minPlan];
}
