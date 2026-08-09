import { describe, expect, it } from "vitest";
import {
  PricingError,
  compareTiers,
  estimateBill,
  workerBreakEven,
  type UsageProfile,
} from "./pricingSimulator.js";

function usage(overrides: Partial<UsageProfile> = {}): UsageProfile {
  return {
    workers: 10,
    projects: 2,
    aiCallsPerMonth: 100,
    storageGb: 5,
    ...overrides,
  };
}

const CANONICAL_TIERS = [
  "gratis",
  "cobre",
  "plata",
  "oro",
  "titanio",
  "platino",
  "diamante",
] as const;

describe("estimateBill", () => {
  it("uses the canonical Cobre price and capacities from pricing/tiers", () => {
    const result = estimateBill("cobre", usage({ workers: 24, projects: 3 }));

    expect(result.baseClp).toBe(9_990);
    expect(result.overage.workers).toEqual({ excess: 0, clp: 0 });
    expect(result.overage.projects).toEqual({ excess: 0, clp: 0 });
    expect(result.fitsWithoutOverage).toBe(true);
  });

  it("uses Cobre canonical worker and project overage rates", () => {
    const result = estimateBill("cobre", usage({ workers: 30, projects: 4 }));

    expect(result.overage.workers).toEqual({ excess: 6, clp: 5_940 });
    expect(result.overage.projects).toEqual({ excess: 1, clp: 5_990 });
    expect(result.totalOverageClp).toBe(11_930);
    expect(result.totalClp).toBe(21_920);
    expect(result.fitsWithoutOverage).toBe(false);
  });

  it("does not invent AI-call or storage charges absent from canonical tiers", () => {
    const result = estimateBill(
      "plata",
      usage({ aiCallsPerMonth: 1_000_000, storageGb: 50_000 }),
    );

    expect(result.overage.aiCalls).toEqual({ excess: 0, clp: 0 });
    expect(result.overage.storage).toEqual({ excess: 0, clp: 0 });
    expect(result.totalClp).toBe(19_990);
  });

  it("reports a premium hard-cap breach without fabricating overage charges", () => {
    const result = estimateBill("titanio", usage({ workers: 2_000 }));

    expect(result.overage.workers).toEqual({ excess: 1, clp: 0 });
    expect(result.totalOverageClp).toBe(0);
    expect(result.totalClp).toBe(249_990);
    expect(result.fitsWithoutOverage).toBe(false);
  });

  it("keeps Diamante worker capacity unlimited while enforcing its project cap", () => {
    const result = estimateBill(
      "diamante",
      usage({ workers: 50_000, projects: 51 }),
    );

    expect(result.overage.workers).toEqual({ excess: 0, clp: 0 });
    expect(result.overage.projects).toEqual({ excess: 1, clp: 0 });
    expect(result.fitsWithoutOverage).toBe(false);
  });

  it("rejects negative and non-finite usage dimensions", () => {
    expect(() =>
      estimateBill("cobre", usage({ workers: Number.NaN })),
    ).toThrowError(PricingError);
    expect(() => estimateBill("cobre", usage({ projects: -1 }))).toThrowError(
      PricingError,
    );
    expect(() =>
      estimateBill("cobre", usage({ storageGb: Infinity })),
    ).toThrowError(PricingError);
  });
});

describe("compareTiers", () => {
  it("compares exactly the seven canonical metallic tiers in canonical order", () => {
    const comparisons = compareTiers("cobre", usage());

    expect(comparisons.map((comparison) => comparison.tier)).toEqual(
      CANONICAL_TIERS,
    );
  });

  it("recommends Plata when Cobre no longer fits and Plata does", () => {
    const comparisons = compareTiers(
      "cobre",
      usage({ workers: 25, projects: 3 }),
    );

    expect(comparisons.find(({ tier }) => tier === "plata")?.recommended).toBe(
      true,
    );
  });

  it("does not recommend a paid tier when Gratis still fits", () => {
    const comparisons = compareTiers(
      "gratis",
      usage({ workers: 3, projects: 1 }),
    );

    expect(comparisons.filter(({ recommended }) => recommended)).toEqual([]);
  });

  it("uses null for an undefined percentage increase from a zero-cost tier", () => {
    const cobre = compareTiers(
      "gratis",
      usage({ workers: 3, projects: 1 }),
    ).find(({ tier }) => tier === "cobre");

    expect(cobre?.diffPctVsCurrent).toBeNull();
  });

  it("returns zero difference for the current tier", () => {
    const current = compareTiers("oro", usage()).find(
      ({ tier }) => tier === "oro",
    );

    expect(current?.diffClpVsCurrent).toBe(0);
    expect(current?.diffPctVsCurrent).toBe(0);
    expect(current?.recommended).toBe(false);
  });
});

describe("workerBreakEven", () => {
  it("finds the first worker where Plata fits and Cobre exceeds its cap", () => {
    expect(
      workerBreakEven("cobre", "plata", usage({ workers: 20, projects: 2 })),
    ).toEqual({ workers: 25, found: true });
  });

  it("rejects a downgrade passed as the next tier", () => {
    expect(() =>
      workerBreakEven("plata", "cobre", usage({ workers: 10, projects: 2 })),
    ).toThrowError(PricingError);
  });
});
