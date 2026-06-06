import type { TierId } from './tiers';

export const SUBSCRIPTION_PLANS = [
  'free',
  'comite',
  'departamento',
  'plata',
  'oro',
  'titanio',
  'platino',
  'empresarial',
  'corporativo',
  'ilimitado',
] as const;

export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const TIER_TO_SUBSCRIPTION_PLAN: Record<TierId, SubscriptionPlan> = {
  gratis: 'free',
  'comite-paritario': 'comite',
  'departamento-prevencion': 'departamento',
  plata: 'plata',
  oro: 'oro',
  titanio: 'titanio',
  diamante: 'platino',
  empresarial: 'empresarial',
  corporativo: 'corporativo',
  ilimitado: 'ilimitado',
  'global-titanio': 'ilimitado',
};

const SUBSCRIPTION_PLAN_SET: ReadonlySet<string> = new Set(SUBSCRIPTION_PLANS);

const LEGACY_ALIASES: Record<string, SubscriptionPlan> = {
  premium: 'departamento',
  basic: 'comite',
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
 * Canonical plan ranking, lowest (free) → highest (ilimitado). SINGLE SOURCE OF
 * TRUTH for tier comparisons, used by BOTH the client feature matrix
 * (`SubscriptionContext`) and the SERVER enforcement middleware
 * (`requireTier`). Tier-gating is UX-only on the client (directive #11) — the
 * authoritative check reads `users/{uid}.subscription.planId` server-side and
 * compares ranks here.
 */
export const PLAN_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  comite: 1,
  departamento: 2,
  plata: 3,
  oro: 4,
  titanio: 5,
  platino: 6, // legacy id for the modern "diamante" slot (titanio < platino < empresarial)
  empresarial: 7,
  corporativo: 8,
  ilimitado: 9,
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
