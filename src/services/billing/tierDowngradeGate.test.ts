import { describe, expect, it } from "vitest";
import { getTierById } from "../pricing/tiers";
import { resolveTierDowngradeGate } from "./tierDowngradeGate";

describe("resolveTierDowngradeGate", () => {
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
