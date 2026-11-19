import { describe, expect, it } from "vitest";
import { getTierById, TIERS } from "../pricing/tiers";
import { PLAN_RANK, SUBSCRIPTION_PLANS, TIER_TO_SUBSCRIPTION_PLAN } from "../pricing/subscriptionPlan";
import { resolveTierDowngradeGate } from "./tierDowngradeGate";

describe("resolveTierDowngradeGate", () => {
  it.each(SUBSCRIPTION_PLANS)("matches the canonical rank for every target from %s", (from) => {
    for (const target of TIERS) {
      const to = TIER_TO_SUBSCRIPTION_PLAN[target.id];
      const expected = PLAN_RANK[to] < PLAN_RANK[from]
        ? { fromTier: from === "free" ? "gratis" : from, toTier: target.id, toTierLabel: target.nombre }
        : null;
      expect(resolveTierDowngradeGate(from, target), target.id).toEqual(expected);
    }
  });

  it("opens the authoritative gate for every real downgrade without trusting client usage totals", () => {
    expect(resolveTierDowngradeGate("oro", getTierById("gratis"))).toEqual({
      fromTier: "oro",
      toTier: "gratis",
      toTierLabel: "Gratis",
    });
  });

  it("does not gate upgrades or the current tier", () => {
    expect(resolveTierDowngradeGate("cobre", getTierById("oro"))).toBeNull();
    expect(resolveTierDowngradeGate("oro", getTierById("oro"))).toBeNull();
  });

  it("maps the subscription free alias to the canonical gratis tier", () => {
    expect(resolveTierDowngradeGate("free", getTierById("gratis"))).toBeNull();
  });
});
