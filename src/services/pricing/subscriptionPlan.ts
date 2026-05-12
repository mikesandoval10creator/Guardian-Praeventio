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
