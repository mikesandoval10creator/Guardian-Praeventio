import {
  isSubscriptionPlan, PLAN_RANK, TIER_TO_SUBSCRIPTION_PLAN, type SubscriptionPlan,
} from "../pricing/subscriptionPlan";
import type { Tier, TierId } from "../pricing/tiers";

export interface TierDowngradeGate {
  fromTier: TierId;
  toTier: TierId;
  toTierLabel: string;
}

function tierIdForPlan(plan: SubscriptionPlan): TierId {
  return plan === "free" ? "gratis" : plan;
}

export function resolveTierDowngradeGate(
  sourcePlan: SubscriptionPlan,
  targetTier: Tier,
): TierDowngradeGate | null {
  const targetPlan = TIER_TO_SUBSCRIPTION_PLAN[targetTier.id];
  if (!isSubscriptionPlan(sourcePlan) || !isSubscriptionPlan(targetPlan)) return null;
  if (PLAN_RANK[targetPlan] >= PLAN_RANK[sourcePlan]) return null;
  return {
    fromTier: tierIdForPlan(sourcePlan),
    toTier: targetTier.id,
    toTierLabel: targetTier.nombre,
  };
}
