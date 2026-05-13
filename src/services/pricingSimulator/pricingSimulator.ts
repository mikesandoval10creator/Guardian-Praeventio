// Praeventio Guard — Sprint 45 §171-173: Pricing Simulator + Calculadora.
//
// Cierra §171 (calculadora pricing), §172 (simulador escenarios),
// §173 (overages) de la 2da tanda usuario.
//
// 100% determinístico. Dado un perfil de uso (workers, projects, AI calls,
// storage GB, etc.) y un tier, calcula:
//   - Monthly bill base
//   - Overages por dimensión que excede límites del tier
//   - Total estimado + comparación con tiers superiores
//   - Punto donde upgrade conviene (break-even)

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type Tier = 'free' | 'starter' | 'pro' | 'enterprise';

export interface TierLimits {
  monthlyBaseClp: number;
  maxWorkers: number;
  maxProjects: number;
  /** AI calls incluidas/mes. */
  includedAiCalls: number;
  /** GB de storage incluidos. */
  includedStorageGb: number;
}

export interface OverageRates {
  /** CLP por trabajador extra. */
  perWorkerClp: number;
  /** CLP por proyecto extra. */
  perProjectClp: number;
  /** CLP por AI call extra. */
  perAiCallClp: number;
  /** CLP por GB storage extra. */
  perStorageGbClp: number;
}

export const TIER_TABLE: Record<Tier, TierLimits> = {
  free: {
    monthlyBaseClp: 0,
    maxWorkers: 5,
    maxProjects: 1,
    includedAiCalls: 50,
    includedStorageGb: 1,
  },
  starter: {
    monthlyBaseClp: 29_990,
    maxWorkers: 25,
    maxProjects: 3,
    includedAiCalls: 500,
    includedStorageGb: 10,
  },
  pro: {
    monthlyBaseClp: 89_990,
    maxWorkers: 100,
    maxProjects: 10,
    includedAiCalls: 5_000,
    includedStorageGb: 100,
  },
  enterprise: {
    monthlyBaseClp: 290_000,
    maxWorkers: Infinity,
    maxProjects: Infinity,
    includedAiCalls: 50_000,
    includedStorageGb: 1_000,
  },
};

export const DEFAULT_OVERAGE_RATES: OverageRates = {
  perWorkerClp: 1_500,
  perProjectClp: 9_990,
  perAiCallClp: 50,
  perStorageGbClp: 990,
};

export interface UsageProfile {
  workers: number;
  projects: number;
  aiCallsPerMonth: number;
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
  /** Si el uso cabe sin overages (verde). */
  fitsWithoutOverage: boolean;
}

export class PricingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PricingError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Core estimation
// ────────────────────────────────────────────────────────────────────────

function safeExcess(used: number, limit: number): number {
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, used - limit);
}

export interface EstimateOptions {
  rates?: OverageRates;
  /** Sobreescribe la tabla de tiers (testing / locale). */
  customTiers?: Partial<Record<Tier, TierLimits>>;
}

export function estimateBill(
  tier: Tier,
  usage: UsageProfile,
  options: EstimateOptions = {},
): BillEstimate {
  if (!Number.isFinite(usage.workers) || usage.workers < 0) {
    throw new PricingError(`workers must be >=0 finite, got ${usage.workers}`);
  }
  if (!Number.isFinite(usage.projects) || usage.projects < 0) {
    throw new PricingError(`projects must be >=0 finite, got ${usage.projects}`);
  }
  if (!Number.isFinite(usage.aiCallsPerMonth) || usage.aiCallsPerMonth < 0) {
    throw new PricingError(`aiCallsPerMonth invalid`);
  }
  if (!Number.isFinite(usage.storageGb) || usage.storageGb < 0) {
    throw new PricingError(`storageGb invalid`);
  }

  const limits = options.customTiers?.[tier] ?? TIER_TABLE[tier];
  const rates = options.rates ?? DEFAULT_OVERAGE_RATES;

  const overage: OverageBreakdown = {
    workers: {
      excess: safeExcess(usage.workers, limits.maxWorkers),
      clp: 0,
    },
    projects: {
      excess: safeExcess(usage.projects, limits.maxProjects),
      clp: 0,
    },
    aiCalls: {
      excess: safeExcess(usage.aiCallsPerMonth, limits.includedAiCalls),
      clp: 0,
    },
    storage: {
      excess: safeExcess(usage.storageGb, limits.includedStorageGb),
      clp: 0,
    },
  };

  overage.workers.clp = overage.workers.excess * rates.perWorkerClp;
  overage.projects.clp = overage.projects.excess * rates.perProjectClp;
  overage.aiCalls.clp = overage.aiCalls.excess * rates.perAiCallClp;
  overage.storage.clp = overage.storage.excess * rates.perStorageGbClp;

  const totalOverageClp =
    overage.workers.clp + overage.projects.clp + overage.aiCalls.clp + overage.storage.clp;

  return {
    tier,
    baseClp: limits.monthlyBaseClp,
    overage,
    totalOverageClp,
    totalClp: limits.monthlyBaseClp + totalOverageClp,
    fitsWithoutOverage: totalOverageClp === 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Cross-tier comparison
// ────────────────────────────────────────────────────────────────────────

export interface TierComparison {
  tier: Tier;
  estimate: BillEstimate;
  /** % cambio vs el tier actual. */
  diffPctVsCurrent: number;
  /** Diff absoluto CLP. */
  diffClpVsCurrent: number;
  /** Si conviene upgrade vs current tier (ahorra dinero o mucho mejor fit). */
  recommended: boolean;
}

/**
 * Compara el tier actual vs todos los demás dados el usage. Útil para
 * §172 simulador: "si crezco a N workers, qué tier conviene?".
 */
export function compareTiers(
  currentTier: Tier,
  usage: UsageProfile,
  options: EstimateOptions = {},
): TierComparison[] {
  const current = estimateBill(currentTier, usage, options);
  const allTiers: Tier[] = ['free', 'starter', 'pro', 'enterprise'];
  return allTiers.map((tier) => {
    const est = estimateBill(tier, usage, options);
    const diffClp = est.totalClp - current.totalClp;
    const diffPct =
      current.totalClp === 0 ? (est.totalClp === 0 ? 0 : Infinity) : (diffClp / current.totalClp) * 100;
    // Recomendado si: cuesta menos O fit perfecto sin overage cuando hoy hay overage
    const recommended =
      tier !== currentTier &&
      (est.totalClp < current.totalClp ||
        (est.fitsWithoutOverage && !current.fitsWithoutOverage));
    return {
      tier,
      estimate: est,
      diffClpVsCurrent: diffClp,
      diffPctVsCurrent: Math.round(diffPct * 10) / 10,
      recommended,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────
// Break-even
// ────────────────────────────────────────────────────────────────────────

/**
 * Encuentra el N de workers donde el upgrade a `nextTier` deja de
 * ser más caro que mantenerse en `currentTier`. Útil para mostrar
 * "te conviene upgradear cuando llegues a X trabajadores".
 */
export function workerBreakEven(
  currentTier: Tier,
  nextTier: Tier,
  baseUsage: UsageProfile,
  options: EstimateOptions = {},
): { workers: number; found: boolean } {
  // Búsqueda lineal hasta 10000 (mining grande); suficiente.
  for (let w = baseUsage.workers; w <= 10_000; w += 5) {
    const a = estimateBill(currentTier, { ...baseUsage, workers: w }, options);
    const b = estimateBill(nextTier, { ...baseUsage, workers: w }, options);
    if (b.totalClp <= a.totalClp) {
      return { workers: w, found: true };
    }
  }
  return { workers: 10_000, found: false };
}
