// Praeventio Guard — canonical metallic-tier pricing simulator.
//
// The product tier catalog lives exclusively in ../pricing/tiers.ts. This
// module projects that catalog into deterministic estimates and comparisons;
// callers cannot override prices or capacities.

import {
  TIER_IDS,
  TIERS,
  calculateMonthlyCost,
  getTierById,
  type TierId,
} from "../pricing/tiers.js";

export type Tier = TierId;

export interface UsageProfile {
  workers: number;
  projects: number;
  /** Retained for wire compatibility; canonical tiers do not price AI calls. */
  aiCallsPerMonth: number;
  /** Retained for wire compatibility; canonical tiers do not price storage. */
  storageGb: number;
}

export interface OverageBreakdown {
  workers: { excess: number; clp: number };
  projects: { excess: number; clp: number };
  aiCalls: { excess: number; clp: number };
  storage: { excess: number; clp: number };
}

export interface BillEstimate {
  tier: Tier;
  baseClp: number;
  overage: OverageBreakdown;
  totalOverageClp: number;
  totalClp: number;
  /** Whether workers and active projects stay within the canonical plan caps. */
  fitsWithoutOverage: boolean;
}

export class PricingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PricingError";
  }
}

function safeExcess(used: number, limit: number): number {
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, used - limit);
}

function validateUsage(usage: UsageProfile): void {
  const dimensions: Array<[keyof UsageProfile, number]> = [
    ["workers", usage.workers],
    ["projects", usage.projects],
    ["aiCallsPerMonth", usage.aiCallsPerMonth],
    ["storageGb", usage.storageGb],
  ];

  for (const [name, value] of dimensions) {
    if (!Number.isFinite(value) || value < 0) {
      throw new PricingError(`${name} must be >=0 finite, got ${value}`);
    }
  }
}

export function estimateBill(tier: Tier, usage: UsageProfile): BillEstimate {
  validateUsage(usage);

  const definition = getTierById(tier);
  const workerExcess = safeExcess(usage.workers, definition.trabajadoresMax);
  const projectExcess = safeExcess(usage.projects, definition.proyectosMax);
  const supportsOverage =
    definition.trabajadorExtraClp !== undefined ||
    definition.proyectoExtraClp !== undefined;
  const canonicalCost =
    (workerExcess === 0 && projectExcess === 0) || supportsOverage
      ? calculateMonthlyCost(tier, usage.workers, usage.projects)
      : {
          base: definition.clpRegular,
          workerOverage: 0,
          projectOverage: 0,
          total: definition.clpRegular,
        };

  const overage: OverageBreakdown = {
    workers: {
      excess: workerExcess,
      clp: canonicalCost.workerOverage,
    },
    projects: {
      excess: projectExcess,
      clp: canonicalCost.projectOverage,
    },
    // No canonical AI/storage allowance or rate exists. Charging the legacy
    // simulator values would recreate a second, contradictory price model.
    aiCalls: { excess: 0, clp: 0 },
    storage: { excess: 0, clp: 0 },
  };

  const totalOverageClp =
    canonicalCost.workerOverage + canonicalCost.projectOverage;

  return {
    tier,
    baseClp: canonicalCost.base,
    overage,
    totalOverageClp,
    totalClp: canonicalCost.total,
    fitsWithoutOverage: workerExcess === 0 && projectExcess === 0,
  };
}

export interface TierComparison {
  tier: Tier;
  estimate: BillEstimate;
  /** Null when the current plan costs zero and percentage change is undefined. */
  diffPctVsCurrent: number | null;
  diffClpVsCurrent: number;
  recommended: boolean;
}

export function compareTiers(
  currentTier: Tier,
  usage: UsageProfile,
): TierComparison[] {
  const current = estimateBill(currentTier, usage);

  return TIER_IDS.map((tier) => {
    const estimate = estimateBill(tier, usage);
    const diffClp = estimate.totalClp - current.totalClp;
    const diffPct =
      current.totalClp === 0
        ? estimate.totalClp === 0
          ? 0
          : null
        : (diffClp / current.totalClp) * 100;

    return {
      tier,
      estimate,
      diffClpVsCurrent: diffClp,
      diffPctVsCurrent: diffPct === null ? null : Math.round(diffPct * 10) / 10,
      recommended:
        tier !== currentTier &&
        estimate.fitsWithoutOverage &&
        (!current.fitsWithoutOverage || estimate.totalClp < current.totalClp),
    };
  });
}

/**
 * Finds the first worker count where the next plan is financially no worse
 * while providing the same fit, or where it becomes the first plan that fits.
 */
export function workerBreakEven(
  currentTier: Tier,
  nextTier: Tier,
  baseUsage: UsageProfile,
): { workers: number; found: boolean } {
  validateUsage(baseUsage);
  const currentIndex = TIERS.findIndex(({ id }) => id === currentTier);
  const nextIndex = TIERS.findIndex(({ id }) => id === nextTier);
  if (nextIndex <= currentIndex) {
    throw new PricingError(
      `nextTier must rank above currentTier, got ${currentTier} -> ${nextTier}`,
    );
  }
  const start = Math.ceil(baseUsage.workers);

  for (let workers = start; workers <= 10_000; workers += 1) {
    const current = estimateBill(currentTier, { ...baseUsage, workers });
    const next = estimateBill(nextTier, { ...baseUsage, workers });
    const nextFirstToFit =
      next.fitsWithoutOverage && !current.fitsWithoutOverage;
    const sameFitAndNoMoreExpensive =
      next.fitsWithoutOverage === current.fitsWithoutOverage &&
      next.totalClp <= current.totalClp;

    if (nextFirstToFit || sameFitAndNoMoreExpensive) {
      return { workers, found: true };
    }
  }

  return { workers: 10_000, found: false };
}
