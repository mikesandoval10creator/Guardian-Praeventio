/**
 * Praeventio Guard — B2D API tiers (single source of truth)
 *
 * 3+1 APIs (Sprint 10, Decisión D4 — 2026-05-03):
 *   A — Climate & Environmental Intelligence
 *   B — Hazmat & Engineering Calculations (Bernoulli)
 *   C — Normativa Chilena & LATAM Compliance
 *   D — Praeventio Intelligence Suite (combo A+B+C + Gemini AI Coach)
 *
 * Each API ships in two tiers: `base` (entry) and `pro` (higher quota,
 * higher rate limit). Suite tier carries the combined surface plus
 * AI Coach access.
 *
 * Initial pricing — values here are starting prices documented in
 * PRICING.md §9.2. They will be revisited after real B2D telemetry
 * (planned Sprint 22). The Zettelkasten privacy boundary (PRICING.md
 * §9.3) is captured per-tier via the mandatory `privacyNote` field.
 *
 * Pricing — Tarifas iniciales (USD/mes); cuotas mensuales; rate-limit
 * por segundo y por día. Combinable con overage por bloques de 10k
 * requests, ver `calculateApiCost`.
 */

/** Stable identifier for a B2D API tier. */
export type ApiTierId =
  | 'climate-base'
  | 'climate-pro'
  | 'hazmat-base'
  | 'hazmat-pro'
  | 'normativa-base'
  | 'normativa-pro'
  | 'suite-base'
  | 'suite-pro';

/** Logical API surface code. A/B/C are individual; D is the Suite combo. */
export type ApiCode = 'A' | 'B' | 'C' | 'D';

/** Per-tier rate limit (server-enforced). */
export interface ApiRateLimit {
  /** Max requests per second per API key. */
  perSecond: number;
  /** Max requests per UTC day per API key. */
  perDay: number;
}

/**
 * A B2D tier definition.
 * Una definición de tier B2D.
 */
export interface ApiTier {
  /** Stable id; never change once published. */
  id: ApiTierId;
  /** Display name (Spanish, public-facing). */
  name: string;
  /** Logical API surface this tier belongs to. */
  apiCode: ApiCode;
  /** Monthly base price in USD. */
  monthlyUsd: number;
  /** Monthly request quota included in `monthlyUsd`. */
  requestsPerMonth: number;
  /** Rate limit applied per API key. */
  rateLimit: ApiRateLimit;
  /** Bullet-list of features promised by this tier (Spanish). */
  features: readonly string[];
  /**
   * Privacy note — explicit reminder that Zettelkasten data is NOT
   * exposed by this API. Mandatory by design (PRICING.md §9.3).
   */
  privacyNote: string;
}

/**
 * Per-block overage cost (10.000 requests = 1 block) keyed by tier shape.
 * `*-base` blocks are pricier than `*-pro` to push heavy users up.
 */
const OVERAGE_USD_PER_10K: Record<'base' | 'pro' | 'suite-base' | 'suite-pro', number> = {
  base: 9,
  pro: 5,
  'suite-base': 4,
  'suite-pro': 4,
};

const ZETTELKASTEN_BOUNDARY =
  'Esta API NO expone el Zettelkasten interno de Praeventio (nodos de proyecto, hallazgos IPER, telemetría de campo, EPP por trabajador, evaluaciones psicosociales individuales, documentos del tenant). Solo datos públicos enriquecidos y motores de cálculo puros. Frontera inviolable — PRICING.md §9.3.';

export const API_TIERS: readonly ApiTier[] = [
  {
    id: 'climate-base',
    name: 'Climate & Environmental Intelligence — Base',
    apiCode: 'A',
    monthlyUsd: 79,
    requestsPerMonth: 100_000,
    rateLimit: { perSecond: 10, perDay: 50_000 },
    features: [
      'Boletín climático CL/LATAM (wrapper Open-Meteo + lógica Praeventio)',
      'Índices sísmicos USGS por radio',
      'Tracker solar/lunar por lat/lng/fecha',
      'Tier por altitud y lógica de inversión cruzada de tema',
    ],
    privacyNote: ZETTELKASTEN_BOUNDARY,
  },
  {
    id: 'climate-pro',
    name: 'Climate & Environmental Intelligence — Pro',
    apiCode: 'A',
    monthlyUsd: 199,
    requestsPerMonth: 1_000_000,
    rateLimit: { perSecond: 50, perDay: 500_000 },
    features: [
      'Todo lo de Climate Base',
      'Históricos hasta 5 años',
      'Pronóstico extendido 14 días',
      'SLA 99.5%',
    ],
    privacyNote: ZETTELKASTEN_BOUNDARY,
  },
  {
    id: 'hazmat-base',
    name: 'Hazmat & Engineering Calculations — Base',
    apiCode: 'B',
    monthlyUsd: 129,
    requestsPerMonth: 50_000,
    rateLimit: { perSecond: 10, perDay: 50_000 },
    features: [
      '6 funciones puras de bernoulliEngine',
      '15 casos de uso BERNOULLI_EXTENSIONS',
      'Presión dinámica, Venturi, carga de viento',
      'Fatiga respiratoria, punto de rocío',
    ],
    privacyNote: ZETTELKASTEN_BOUNDARY,
  },
  {
    id: 'hazmat-pro',
    name: 'Hazmat & Engineering Calculations — Pro',
    apiCode: 'B',
    monthlyUsd: 329,
    requestsPerMonth: 500_000,
    rateLimit: { perSecond: 50, perDay: 500_000 },
    features: [
      'Todo lo de Hazmat Base',
      'Batch de hasta 1.000 cálculos por request',
      'Webhooks de cálculo asíncrono',
      'SLA 99.5%',
    ],
    privacyNote: ZETTELKASTEN_BOUNDARY,
  },
  {
    id: 'normativa-base',
    name: 'Normativa Chilena & LATAM Compliance — Base',
    apiCode: 'C',
    monthlyUsd: 149,
    requestsPerMonth: 50_000,
    rateLimit: { perSecond: 10, perDay: 50_000 },
    features: [
      '15 normativas chilenas (DS 54, DS 40, Ley 16.744, NCh, etc.)',
      '5 protocolos chilenos',
      'ISO 45001 fallback global',
      'Endpoint applies-to (proyecto → normativas aplicables)',
    ],
    privacyNote: ZETTELKASTEN_BOUNDARY,
  },
  {
    id: 'normativa-pro',
    name: 'Normativa Chilena & LATAM Compliance — Pro',
    apiCode: 'C',
    monthlyUsd: 399,
    requestsPerMonth: 500_000,
    rateLimit: { perSecond: 50, perDay: 500_000 },
    features: [
      'Todo lo de Normativa Base',
      'Roadmap LATAM completo (Q2 PE/CO, Q3 MX/AR, Q4 BR/EC)',
      'Histórico de versiones de cada norma',
      'SLA 99.5%',
    ],
    privacyNote: ZETTELKASTEN_BOUNDARY,
  },
  {
    id: 'suite-base',
    name: 'Praeventio Intelligence Suite — Base',
    apiCode: 'D',
    monthlyUsd: 399,
    requestsPerMonth: 200_000,
    rateLimit: { perSecond: 20, perDay: 100_000 },
    features: [
      'Todo lo de Climate Base + Hazmat Base + Normativa Base',
      'Acceso a Gemini AI Coach con contexto Praeventio',
      'Endpoints combinados de Suite',
    ],
    privacyNote: ZETTELKASTEN_BOUNDARY,
  },
  {
    id: 'suite-pro',
    name: 'Praeventio Intelligence Suite — Pro',
    apiCode: 'D',
    monthlyUsd: 899,
    requestsPerMonth: 2_000_000,
    rateLimit: { perSecond: 100, perDay: 1_000_000 },
    features: [
      'Todo lo de Climate Pro + Hazmat Pro + Normativa Pro',
      'AI Coach con prioridad y contexto extendido',
      'SLA 99.9%',
      'Soporte enterprise dedicado',
    ],
    privacyNote: ZETTELKASTEN_BOUNDARY,
  },
];

/** Return tier shape (`base`, `pro`, `suite-base`, `suite-pro`) for overage table. */
function overageKey(id: ApiTierId): keyof typeof OVERAGE_USD_PER_10K {
  if (id === 'suite-base') return 'suite-base';
  if (id === 'suite-pro') return 'suite-pro';
  return id.endsWith('-pro') ? 'pro' : 'base';
}

/**
 * Calculate monthly cost in USD for a tier given a projected request volume.
 * Calcula el costo mensual proyectado para un tier dado un volumen de requests.
 *
 * Cost model:
 *   - If `projectedRequests <= tier.requestsPerMonth`: cost = `tier.monthlyUsd`
 *     (the included quota covers the workload).
 *   - Else: cost = `tier.monthlyUsd` + ⌈overage / 10.000⌉ × overageRate.
 *
 * @param tier The tier definition.
 * @param projectedRequests Projected monthly requests (must be >= 0).
 * @returns Total USD/month rounded to 2 decimals.
 * @throws If `projectedRequests` is negative or non-finite.
 */
export function calculateApiCost(tier: ApiTier, projectedRequests: number): number {
  if (!Number.isFinite(projectedRequests) || projectedRequests < 0) {
    throw new RangeError('projectedRequests must be a finite, non-negative number');
  }

  if (projectedRequests <= tier.requestsPerMonth) {
    return tier.monthlyUsd;
  }

  const overage = projectedRequests - tier.requestsPerMonth;
  const blocks = Math.ceil(overage / 10_000);
  const ratePerBlock = OVERAGE_USD_PER_10K[overageKey(tier.id)];
  const total = tier.monthlyUsd + blocks * ratePerBlock;
  return Math.round(total * 100) / 100;
}

/** Convenience lookup. Throws if id is unknown — keeps callers honest. */
export function getApiTier(id: ApiTierId): ApiTier {
  const found = API_TIERS.find((t) => t.id === id);
  if (!found) {
    throw new Error(`Unknown ApiTierId: ${id}`);
  }
  return found;
}
