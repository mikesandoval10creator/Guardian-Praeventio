import type { SubscriptionPlan } from "../pricing/subscriptionPlan";
import { TIERS, type Tier, type TierId } from "../pricing/tiers";

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
  const fromTier = tierIdForPlan(sourcePlan);
  const fromIndex = TIERS.findIndex((tier) => tier.id === fromTier);
  const targetIndex = TIERS.findIndex((tier) => tier.id === targetTier.id);
  if (fromIndex < 0 || targetIndex < 0 || targetIndex >= fromIndex) return null;
  return {
    fromTier,
    toTier: targetTier.id,
    toTierLabel: targetTier.nombre,
  };
}
