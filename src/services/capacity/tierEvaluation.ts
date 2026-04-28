/**
 * Deterministic capacity / tier evaluation.
 *
 * Pure logic, no I/O. Consumed by `useProjectCapacity` and (eventually) the
 * Pricing page. Tier data is INJECTED so this module stays decoupled from
 * IMP1's `src/services/pricing/tiers.ts` (which may not exist yet at the
 * time of writing).
 */

export interface ProjectInfo {
  id: string;
  workerCount: number;
}

export interface CapacityState {
  totalWorkers: number;
  totalProjects: number;
  perProjectWorkers: ProjectInfo[];
}

/**
 * Minimal tier shape required by this evaluator. The full tier shape lives
 * in IMP1's pricing/tiers.ts; this is the structural subset we need.
 */
export interface TierData {
  id: string;
  clpRegular: number;
  trabajadoresMax: number;
  proyectosMax: number;
  /** CLP charged per worker over `trabajadoresMax`. 0 = no overage allowed. */
  workerOverageClp: number;
  /** CLP charged per project over `proyectosMax`. 0 = no overage allowed. */
  projectOverageClp: number;
  /**
   * Premium tiers don't sell overage capacity — going over forces an upgrade.
   * (Titanio and above per PRICING.md.)
   */
  isPremium: boolean;
}

export type CapacityReason =
  | 'within'
  | 'workers-over'
  | 'projects-over'
  | 'both-over'
  | 'premium-blocked';

export interface TierEvaluation {
  currentTierId: string;
  withinLimits: boolean;
  workerOverflow: number;
  projectOverflow: number;
  monthlyOverageClp: number;
  totalMonthlyClp: number;
  suggestedTierId: string | null;
  upgradeSavingsClp: number;
  reason: CapacityReason;
}

function findTier(tierData: TierData[], id: string): TierData {
  const tier = tierData.find((t) => t.id === id);
  if (!tier) {
    throw new Error(`Unknown tier id: ${id}`);
  }
  return tier;
}

/**
 * Returns the next tier (by index) after `currentId`, or null if at the top.
 */
function nextTier(tierData: TierData[], currentId: string): TierData | null {
  const idx = tierData.findIndex((t) => t.id === currentId);
  if (idx < 0 || idx >= tierData.length - 1) return null;
  return tierData[idx + 1];
}

export function evaluateCapacity(
  currentTierId: string,
  state: CapacityState,
  tierData: TierData[],
): TierEvaluation {
  const tier = findTier(tierData, currentTierId);

  const workerOverflow = Math.max(0, state.totalWorkers - tier.trabajadoresMax);
  const projectOverflow = Math.max(0, state.totalProjects - tier.proyectosMax);

  // Reason classification (independent of pricing).
  let reason: CapacityReason;
  if (workerOverflow === 0 && projectOverflow === 0) {
    reason = 'within';
  } else if (tier.isPremium) {
    reason = 'premium-blocked';
  } else if (workerOverflow > 0 && projectOverflow > 0) {
    reason = 'both-over';
  } else if (workerOverflow > 0) {
    reason = 'workers-over';
  } else {
    reason = 'projects-over';
  }

  // Overage cost: only when the tier sells overage.
  const monthlyOverageClp = tier.isPremium
    ? 0
    : workerOverflow * tier.workerOverageClp +
      projectOverflow * tier.projectOverageClp;

  const totalMonthlyClp = tier.clpRegular + monthlyOverageClp;
  const withinLimits = reason === 'within';

  // Upgrade suggestion logic.
  let suggestedTierId: string | null = null;
  let upgradeSavingsClp = 0;

  if (!withinLimits) {
    const next = nextTier(tierData, currentTierId);
    if (next) {
      const hardBlocked =
        // Premium tiers must upgrade — no overage path.
        tier.isPremium ||
        // Non-premium tiers with no overage rate are also hard-blocked
        // (e.g., Gratis: going over the cap is not billable, only upgradable).
        (tier.workerOverageClp === 0 && tier.projectOverageClp === 0);

      if (hardBlocked) {
        suggestedTierId = next.id;
        // Savings only meaningful if we were paying overage; for hard-blocked
        // tiers (Gratis / Premium) there is no overage being paid, so
        // upgradeSavingsClp stays 0.
        upgradeSavingsClp = Math.max(0, totalMonthlyClp - next.clpRegular);
      } else {
        // Soft path: only suggest if overage cost exceeds the price delta to
        // the next tier (i.e., upgrading is cheaper than continuing to pay
        // overage).
        const delta = next.clpRegular - tier.clpRegular;
        if (monthlyOverageClp > delta) {
          suggestedTierId = next.id;
          upgradeSavingsClp = totalMonthlyClp - next.clpRegular;
        }
      }
    }
  }

  return {
    currentTierId,
    withinLimits,
    workerOverflow,
    projectOverflow,
    monthlyOverageClp,
    totalMonthlyClp,
    suggestedTierId,
    upgradeSavingsClp,
    reason,
  };
}
