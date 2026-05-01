/**
 * Praeventio Guard - Pricing Tiers (single source of truth)
 *
 * 10 tiers covering Gratis, Comité Paritario, Departamento Prevención,
 * Plata, Oro, Titanio, Diamante, Empresarial, Corporativo, Ilimitado.
 *
 * All tiers include: calendar predictions full, multi-país ilimitado,
 * ISO 45001 fallback universal cuando GPS detecta país sin pack local.
 *
 * Lower tiers (Gratis through Oro) charge overage per extra worker / project.
 * Premium tiers (Titanio+) have NO overage — predictable enterprise pricing
 * with hard upgrade required when limits are exceeded.
 */

export type TierId =
  | 'gratis'
  | 'comite-paritario'
  | 'departamento-prevencion'
  | 'plata'
  | 'oro'
  | 'titanio'
  | 'diamante'
  | 'empresarial'
  | 'corporativo'
  | 'ilimitado';

export type WorkspaceTier =
  | 'none'
  | 'sso-basic'
  | 'sso-casa'
  | 'multi-tenant'
  | 'multi-tenant-csm'
  | 'vertex-finetuned';

export interface Tier {
  id: TierId;
  nombre: string;
  trabajadoresMax: number;
  proyectosMax: number;
  clpRegular: number;
  clpIntro3mo: number;
  clpAnual: number;
  usdRegular: number;
  workspaceTier: WorkspaceTier;
  /** Per-extra-worker price in CLP, if overage is supported. */
  trabajadorExtraClp?: number;
  /** Per-extra-project price in CLP, if overage is supported. */
  proyectoExtraClp?: number;
}

export const TIERS: readonly Tier[] = [
  {
    id: 'gratis',
    nombre: 'Gratis',
    trabajadoresMax: 10,
    proyectosMax: 1,
    clpRegular: 0,
    clpIntro3mo: 0,
    clpAnual: 0,
    usdRegular: 0,
    workspaceTier: 'none',
  },
  {
    id: 'comite-paritario',
    nombre: 'Comité Paritario',
    trabajadoresMax: 25,
    proyectosMax: 3,
    clpRegular: 11990,
    clpIntro3mo: 7990,
    clpAnual: 96990,
    usdRegular: 13,
    workspaceTier: 'none',
    trabajadorExtraClp: 990,
    proyectoExtraClp: 5990,
  },
  {
    id: 'departamento-prevencion',
    nombre: 'Departamento Prevención',
    trabajadoresMax: 100,
    proyectosMax: 10,
    clpRegular: 30990,
    clpIntro3mo: 21990,
    clpAnual: 288990,
    usdRegular: 33,
    workspaceTier: 'none',
    trabajadorExtraClp: 490,
    proyectoExtraClp: 4990,
  },
  {
    id: 'plata',
    nombre: 'Plata',
    trabajadoresMax: 250,
    proyectosMax: 25,
    clpRegular: 50990,
    clpIntro3mo: 35990,
    clpAnual: 480990,
    usdRegular: 54,
    workspaceTier: 'none',
    trabajadorExtraClp: 290,
    proyectoExtraClp: 3990,
  },
  {
    id: 'oro',
    nombre: 'Oro',
    trabajadoresMax: 500,
    proyectosMax: 50,
    clpRegular: 90990,
    clpIntro3mo: 63990,
    clpAnual: 864990,
    usdRegular: 96,
    workspaceTier: 'none',
    trabajadorExtraClp: 190,
    proyectoExtraClp: 2990,
  },
  {
    id: 'titanio',
    nombre: 'Titanio',
    trabajadoresMax: 750,
    proyectosMax: 75,
    clpRegular: 249990,
    clpIntro3mo: 174990,
    clpAnual: 2399990,
    usdRegular: 263,
    workspaceTier: 'sso-basic',
  },
  {
    id: 'diamante',
    nombre: 'Diamante',
    trabajadoresMax: 1000,
    proyectosMax: 100,
    clpRegular: 499990,
    clpIntro3mo: 349990,
    clpAnual: 4799990,
    usdRegular: 526,
    workspaceTier: 'sso-casa',
  },
  {
    id: 'empresarial',
    nombre: 'Empresarial',
    trabajadoresMax: 2500,
    proyectosMax: 250,
    clpRegular: 1499990,
    clpIntro3mo: 1049990,
    clpAnual: 14399990,
    usdRegular: 1578,
    workspaceTier: 'multi-tenant',
  },
  {
    id: 'corporativo',
    nombre: 'Corporativo',
    trabajadoresMax: 5000,
    proyectosMax: 500,
    clpRegular: 2999990,
    clpIntro3mo: 2099990,
    clpAnual: 28799990,
    usdRegular: 3158,
    workspaceTier: 'multi-tenant-csm',
  },
  {
    id: 'ilimitado',
    nombre: 'Ilimitado',
    trabajadoresMax: Infinity,
    proyectosMax: Infinity,
    clpRegular: 5999990,
    clpIntro3mo: 4199990,
    clpAnual: 57599990,
    usdRegular: 6315,
    workspaceTier: 'vertex-finetuned',
  },
];

const TIERS_BY_ID: Record<TierId, Tier> = TIERS.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {} as Record<TierId, Tier>);

const TIER_INDEX: Record<TierId, number> = TIERS.reduce((acc, t, i) => {
  acc[t.id] = i;
  return acc;
}, {} as Record<TierId, number>);

const PREMIUM_TIERS: ReadonlySet<TierId> = new Set<TierId>([
  'titanio',
  'diamante',
  'empresarial',
  'corporativo',
  'ilimitado',
]);

export function getTierById(id: TierId): Tier {
  const tier = TIERS_BY_ID[id];
  if (!tier) {
    throw new Error(`Unknown tier id: ${id}`);
  }
  return tier;
}

export type Currency = 'CLP' | 'USD';

/**
 * Format a money amount with locale-aware separators.
 * - CLP: Chilean punctuation (dots for thousands, no decimals): "$11.990 CLP"
 * - USD: comma thousands separator, no decimals: "$13 USD"
 */
export function formatCurrency(amount: number, currency: Currency): string {
  const rounded = Math.round(amount);
  if (currency === 'CLP') {
    // Use es-CL formatting for Chilean dot-thousands
    const formatted = new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(rounded);
    return `$${formatted} CLP`;
  }
  // USD
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(rounded);
  return `$${formatted} USD`;
}

/**
 * Reverse-engineered IVA breakdown.
 * Chilean IVA = 19%.
 * Given a "subtotal" (neto) input, computes IVA and total such that
 * subtotal + iva = total. We round IVA so that the total is the
 * canonical .990 retail figure that users see on the cards.
 */
export function withIVA(subtotal: number): { subtotal: number; iva: number; total: number } {
  if (subtotal <= 0) {
    return { subtotal: 0, iva: 0, total: 0 };
  }
  // Use ceiling so the displayed retail total matches the canonical .990 figure
  // (e.g. subtotal 10075 + IVA 1915 = total 11990, not 11989).
  const ivaRaw = subtotal * 0.19;
  const iva = Math.ceil(ivaRaw - 1e-9); // tiny epsilon to keep exact integers exact
  const total = subtotal + iva;
  return { subtotal, iva, total };
}

export interface MonthlyCost {
  base: number;
  workerOverage: number;
  projectOverage: number;
  total: number;
}

/**
 * Compute the monthly CLP cost for a tier given current usage.
 * - Lower tiers (Comité through Oro) add overage per extra worker / project.
 * - Premium tiers (Titanio+) THROW if usage exceeds capacity — forcing upgrade.
 * - Gratis returns 0 if within limits, throws if exceeded.
 */
export function calculateMonthlyCost(
  tierId: TierId,
  totalWorkers: number,
  totalProjects: number,
): MonthlyCost {
  const tier = getTierById(tierId);
  const base = tier.clpRegular;

  const workerExcess = Math.max(0, totalWorkers - tier.trabajadoresMax);
  const projectExcess = Math.max(0, totalProjects - tier.proyectosMax);

  const isPremium = PREMIUM_TIERS.has(tierId);
  if (isPremium) {
    if (workerExcess > 0 || projectExcess > 0) {
      throw new Error(
        `Tier "${tierId}" exceeded its capacity (workers=${totalWorkers}, projects=${totalProjects}). Premium tiers do not support overage — please upgrade.`,
      );
    }
    return { base, workerOverage: 0, projectOverage: 0, total: base };
  }

  if (tierId === 'gratis') {
    if (workerExcess > 0 || projectExcess > 0) {
      throw new Error(
        `Tier "gratis" exceeded its capacity (workers=${totalWorkers}, projects=${totalProjects}). Please upgrade to a paid tier.`,
      );
    }
    return { base: 0, workerOverage: 0, projectOverage: 0, total: 0 };
  }

  const trabajadorExtra = tier.trabajadorExtraClp ?? 0;
  const proyectoExtra = tier.proyectoExtraClp ?? 0;
  const workerOverage = workerExcess * trabajadorExtra;
  const projectOverage = projectExcess * proyectoExtra;
  const total = base + workerOverage + projectOverage;

  return { base, workerOverage, projectOverage, total };
}

/**
 * Suggest an upgrade if current overage cost exceeds the delta to the next tier price.
 * Returns the next-tier id, or null if no upgrade is warranted.
 * Premium tiers always return null (no overage, hard upgrade is handled separately).
 */
export function suggestUpgrade(
  tierId: TierId,
  totalWorkers: number,
  totalProjects: number,
): TierId | null {
  if (PREMIUM_TIERS.has(tierId)) {
    return null;
  }

  let cost: MonthlyCost;
  try {
    cost = calculateMonthlyCost(tierId, totalWorkers, totalProjects);
  } catch {
    // gratis exceeded: always recommend the next tier
    const idx = TIER_INDEX[tierId];
    const next = TIERS[idx + 1];
    return next ? next.id : null;
  }

  const overage = cost.workerOverage + cost.projectOverage;
  if (overage <= 0) {
    return null;
  }

  const idx = TIER_INDEX[tierId];
  const next = TIERS[idx + 1];
  if (!next) {
    return null;
  }
  const delta = next.clpRegular - cost.base;
  if (overage > delta) {
    return next.id;
  }
  return null;
}
