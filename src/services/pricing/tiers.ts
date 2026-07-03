/**
 * Praeventio Guard - Pricing Tiers (single source of truth)
 *
 * 7 metal+jewel tiers (2026-06-15 collapse, no customers yet → clean rebuild,
 * no migration): Gratis, Cobre, Plata, Oro, Titanio, Platino, Diamante.
 *
 * The customer-facing ladder. Legal modules (CPHS at ≥25/faena, Departamento de
 * Prevención at ≥100) unlock by HEADCOUNT, decoupled from the plan name (see
 * the headcount-trigger function). Plata roughly coincides with the CPHS band
 * and Oro with the DPRP band, but the gating is data-driven, not name-driven.
 *
 * All tiers include: calendar predictions full, multi-país ilimitado, ISO 45001
 * fallback universal cuando GPS detecta país sin pack local, Zettelkasten, and
 * every life-safety feature (ADR 0021 — never tier-gated).
 *
 * Lower tiers (Cobre through Oro) charge overage per extra worker / project.
 * Premium tiers (Titanio+) have NO overage — predictable pricing with a hard
 * upgrade required when limits are exceeded. Annual = clpRegular × 9 (≈25% off,
 * "ahorra 3 meses"). Diamante is the jewel: unlimited + multi-jurisdiction +
 * per-region data residency (UF indexation deferred; CLP placeholder for now).
 */

export type TierId =
  | 'gratis'
  | 'cobre'
  | 'plata'
  | 'oro'
  | 'titanio'
  | 'platino'
  | 'diamante';

/**
 * Sprint 31 OO — Data residency tiers.
 *  - 'latam': single jurisdicción (datos en CL/región LATAM).
 *  - 'multi': multi-jurisdicción simultáneo (Tier Diamante).
 */
export type DataResidency = 'latam' | 'multi';

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
  /**
   * Sprint 31 OO — Maximum simultaneous jurisdictions this tier may
   * activate (ISO 45001 baseline does NOT count). Most tiers are
   * single-jurisdiction (1). Tier Diamante is `Infinity`.
   */
  jurisdictionsMax?: number;
  /**
   * Sprint 31 OO — Data residency posture. `'latam'` keeps data in a
   * single LATAM region; `'multi'` distributes per active jurisdiction.
   */
  dataResidency?: DataResidency;
  /**
   * Sprint 31 OO — Marker the orchestrator AI reads to activate Vertex
   * AI globally instead of just LATAM region.
   */
  multiJurisdiction?: boolean;
}

export const TIERS: readonly Tier[] = [
  {
    id: 'gratis',
    nombre: 'Gratis',
    trabajadoresMax: 3,
    proyectosMax: 1,
    clpRegular: 0,
    clpIntro3mo: 0,
    clpAnual: 0,
    usdRegular: 0,
    workspaceTier: 'none',
  },
  {
    // Intermedio multi-faena: hasta 3 faenas, cada una bajo el umbral CPHS
    // (<25), sin necesidad de Comité Paritario por faena (DS 44/2024 art. 23,
    // que cuenta por faena). "Bueno, bonito y barato".
    id: 'cobre',
    nombre: 'Cobre',
    trabajadoresMax: 72,
    proyectosMax: 3,
    clpRegular: 9990,
    clpIntro3mo: 6990,
    clpAnual: 89910, // 9990 × 9 — ahorra 3 meses (≈25%)
    usdRegular: 11,
    workspaceTier: 'none',
    trabajadorExtraClp: 990,
    proyectoExtraClp: 5990,
  },
  {
    // Banda en que el Comité Paritario (CPHS) suele activarse (≥25/faena).
    id: 'plata',
    nombre: 'Plata',
    trabajadoresMax: 99,
    proyectosMax: 5,
    clpRegular: 19990,
    clpIntro3mo: 13990,
    clpAnual: 179910,
    usdRegular: 22,
    workspaceTier: 'none',
    trabajadorExtraClp: 490,
    proyectoExtraClp: 4990,
  },
  {
    // Banda en que el Departamento de Prevención de Riesgos se activa (≥100).
    id: 'oro',
    nombre: 'Oro',
    trabajadoresMax: 499,
    proyectosMax: 10,
    clpRegular: 79990,
    clpIntro3mo: 55990,
    clpAnual: 719910,
    usdRegular: 88,
    workspaceTier: 'none',
    trabajadorExtraClp: 290,
    proyectoExtraClp: 3990,
  },
  {
    id: 'titanio',
    nombre: 'Titanio',
    trabajadoresMax: 1999,
    proyectosMax: 20,
    clpRegular: 249990,
    clpIntro3mo: 174990,
    clpAnual: 2249910,
    usdRegular: 270,
    workspaceTier: 'sso-basic',
  },
  {
    id: 'platino',
    nombre: 'Platino',
    trabajadoresMax: 9999,
    proyectosMax: 30,
    clpRegular: 899990,
    clpIntro3mo: 629990,
    clpAnual: 8099910,
    usdRegular: 970,
    workspaceTier: 'multi-tenant-csm',
  },
  {
    // La joya: ilimitado + multi-jurisdicción + residencia de datos por región.
    // TODO(uf): indexar a UF (anclado ~100 UF); CLP placeholder por ahora.
    id: 'diamante',
    nombre: 'Diamante',
    trabajadoresMax: Infinity,
    proyectosMax: 50,
    clpRegular: 3900000,
    clpIntro3mo: 2730000,
    clpAnual: 35100000,
    usdRegular: 4200,
    workspaceTier: 'vertex-finetuned',
    jurisdictionsMax: Infinity,
    dataResidency: 'multi',
    multiJurisdiction: true,
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
  'platino',
  'diamante',
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
 * - Lower tiers (Cobre through Oro) add overage per extra worker / project.
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
