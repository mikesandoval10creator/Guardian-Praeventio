// Praeventio Guard — Sprint 39 Fase D.10: Safety metrics OSHA + ICMM.
//
// Cierra: Plan Fase D.10 "vuetify-riskvis (TRIR/LTIFR/REBA/RULA)"
//
// Métricas estándar internacional para reportes SST a gerencia,
// mutualidad, clientes mandantes y reguladores:
//
//   - TRIR (Total Recordable Incident Rate) — OSHA 29 CFR 1904
//   - LTIFR (Lost Time Injury Frequency Rate) — ICMM / ILO
//   - DART (Days Away, Restricted, Transferred) — OSHA
//   - SIFR (Serious Injury & Fatality Rate) — ICMM SIF
//   - Severity Rate — días perdidos por 200k horas
//   - Frequency Index ILO — accidentes por millón de horas (CL/EU)
//
// Fórmulas canónicas: (incidents × base) / total_hours_worked
//   base OSHA = 200_000 (100 trabajadores × 50 sem × 40 h)
//   base ILO = 1_000_000 (un millón de horas)
//
// Determinístico, sin LLM. Inputs simples, outputs auditables.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/**
 * Conteo de eventos clasificados según OSHA 1904.7 + ICMM SIF.
 * El caller decide la clasificación; este motor NO clasifica.
 */
export interface IncidentCounts {
  /** Total recordable: muerte, día perdido, restricción, traslado, atención médica >first-aid, conciencia perdida. */
  totalRecordable: number;
  /** Lost time: trabajador no pudo volver al día siguiente. */
  lostTime: number;
  /** Días con actividad restringida / transferida. */
  restrictedOrTransferred: number;
  /** Eventos clasificados como SIF (Serious Injury or Fatality). */
  seriousInjuriesAndFatalities: number;
  /** Solo fatalidades. */
  fatalities: number;
  /** Suma total de días perdidos en el período. */
  totalLostDays: number;
}

export interface ExposureInput {
  /** Total horas trabajadas en el período (suma de todos los trabajadores). */
  totalHoursWorked: number;
}

export type MetricBase = 'osha_200k' | 'ilo_1m';

export const BASE_FACTORS: Record<MetricBase, number> = {
  osha_200k: 200_000,
  ilo_1m: 1_000_000,
};

// ────────────────────────────────────────────────────────────────────────
// Pure formulas
// ────────────────────────────────────────────────────────────────────────

/**
 * Generic rate calculator: (events × base) / hours.
 * Returns 0 if hours <= 0 (sin exposición → tasa indefinida que reportamos como 0).
 * Returns NaN si events negativo o no finito.
 */
export function calculateRate(
  events: number,
  hours: number,
  base: number,
): number {
  if (!Number.isFinite(events) || events < 0) return NaN;
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  if (!Number.isFinite(base) || base <= 0) return NaN;
  return (events * base) / hours;
}

/**
 * TRIR — Total Recordable Incident Rate (OSHA 200,000 base).
 */
export function calculateTrir(
  counts: Pick<IncidentCounts, 'totalRecordable'>,
  exposure: ExposureInput,
): number {
  return calculateRate(counts.totalRecordable, exposure.totalHoursWorked, BASE_FACTORS.osha_200k);
}

/**
 * LTIFR — Lost Time Injury Frequency Rate (ICMM/ILO 1,000,000 base).
 */
export function calculateLtifr(
  counts: Pick<IncidentCounts, 'lostTime'>,
  exposure: ExposureInput,
): number {
  return calculateRate(counts.lostTime, exposure.totalHoursWorked, BASE_FACTORS.ilo_1m);
}

/**
 * DART — Days Away, Restricted or Transferred Rate (OSHA 200,000 base).
 * Incluye lostTime + restrictedOrTransferred.
 */
export function calculateDart(
  counts: Pick<IncidentCounts, 'lostTime' | 'restrictedOrTransferred'>,
  exposure: ExposureInput,
): number {
  const total = counts.lostTime + counts.restrictedOrTransferred;
  return calculateRate(total, exposure.totalHoursWorked, BASE_FACTORS.osha_200k);
}

/**
 * SIFR — Serious Injury & Fatality Rate (ICMM base 1M).
 * Métrica clave para minería + petróleo + construcción pesada.
 */
export function calculateSifr(
  counts: Pick<IncidentCounts, 'seriousInjuriesAndFatalities'>,
  exposure: ExposureInput,
): number {
  return calculateRate(
    counts.seriousInjuriesAndFatalities,
    exposure.totalHoursWorked,
    BASE_FACTORS.ilo_1m,
  );
}

/**
 * Severity Rate — días perdidos × 200,000 / horas (OSHA-style).
 * Útil para distinguir empresas con muchos near-miss vs pocos
 * eventos graves.
 */
export function calculateSeverityRate(
  counts: Pick<IncidentCounts, 'totalLostDays'>,
  exposure: ExposureInput,
): number {
  return calculateRate(counts.totalLostDays, exposure.totalHoursWorked, BASE_FACTORS.osha_200k);
}

/**
 * Frequency Index ILO — accidentes recordables por millón de horas.
 * Más usado en estadísticas europeas/CL que TRIR (que es OSHA-US).
 */
export function calculateFrequencyIndex(
  counts: Pick<IncidentCounts, 'totalRecordable'>,
  exposure: ExposureInput,
): number {
  return calculateRate(counts.totalRecordable, exposure.totalHoursWorked, BASE_FACTORS.ilo_1m);
}

/**
 * Fatality rate por millón de horas (ICMM/ILO).
 */
export function calculateFatalityRate(
  counts: Pick<IncidentCounts, 'fatalities'>,
  exposure: ExposureInput,
): number {
  return calculateRate(counts.fatalities, exposure.totalHoursWorked, BASE_FACTORS.ilo_1m);
}

// ────────────────────────────────────────────────────────────────────────
// Industry benchmarks (BLS 2023 + ICMM 2022 + SUSESO Chile)
// ────────────────────────────────────────────────────────────────────────

export type IndustryBenchmark =
  | 'construction_cl'
  | 'mining_cl'
  | 'manufacturing_us'
  | 'oil_gas_us'
  | 'agriculture_us'
  | 'transport_cl'
  | 'all_industries_us';

/**
 * Benchmarks públicos para comparación. Fuentes:
 *   - BLS Table 1, 2023 (US TRIR)
 *   - SUSESO 2023 Anuario Estadístico (CL accidentabilidad)
 *   - ICMM 2022 (mining global)
 */
export const BENCHMARK_TRIR: Record<IndustryBenchmark, number> = {
  construction_cl: 4.5,
  mining_cl: 1.8,
  manufacturing_us: 3.0,
  oil_gas_us: 0.7,
  agriculture_us: 5.5,
  transport_cl: 3.2,
  all_industries_us: 2.7,
};

export const BENCHMARK_LTIFR: Record<IndustryBenchmark, number> = {
  construction_cl: 18,
  mining_cl: 4,
  manufacturing_us: 12,
  oil_gas_us: 2,
  agriculture_us: 22,
  transport_cl: 14,
  all_industries_us: 11,
};

export interface BenchmarkComparison {
  metric: 'trir' | 'ltifr';
  value: number;
  benchmark: number;
  industry: IndustryBenchmark;
  /** True si por debajo (mejor) del benchmark. */
  betterThanBenchmark: boolean;
  /** Porcentaje vs benchmark (50 = mitad; 200 = doble). */
  percentOfBenchmark: number;
}

export function compareTrirVsIndustry(
  value: number,
  industry: IndustryBenchmark,
): BenchmarkComparison {
  const benchmark = BENCHMARK_TRIR[industry];
  return {
    metric: 'trir',
    value,
    benchmark,
    industry,
    betterThanBenchmark: value < benchmark,
    percentOfBenchmark: benchmark > 0 ? Math.round((value / benchmark) * 100) : 0,
  };
}

export function compareLtifrVsIndustry(
  value: number,
  industry: IndustryBenchmark,
): BenchmarkComparison {
  const benchmark = BENCHMARK_LTIFR[industry];
  return {
    metric: 'ltifr',
    value,
    benchmark,
    industry,
    betterThanBenchmark: value < benchmark,
    percentOfBenchmark: benchmark > 0 ? Math.round((value / benchmark) * 100) : 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Full dashboard report
// ────────────────────────────────────────────────────────────────────────

export interface SafetyMetricsReport {
  trir: number;
  ltifr: number;
  dart: number;
  sifr: number;
  severityRate: number;
  frequencyIndex: number;
  fatalityRate: number;
  /** Total horas para auditoría. */
  totalHoursWorked: number;
  /** Reporting period label. */
  periodLabel?: string;
}

/**
 * Construye reporte completo. Todas las métricas en una sola llamada
 * para dashboards ejecutivos.
 */
export function buildSafetyMetricsReport(
  counts: IncidentCounts,
  exposure: ExposureInput,
  periodLabel?: string,
): SafetyMetricsReport {
  return {
    trir: calculateTrir(counts, exposure),
    ltifr: calculateLtifr(counts, exposure),
    dart: calculateDart(counts, exposure),
    sifr: calculateSifr(counts, exposure),
    severityRate: calculateSeverityRate(counts, exposure),
    frequencyIndex: calculateFrequencyIndex(counts, exposure),
    fatalityRate: calculateFatalityRate(counts, exposure),
    totalHoursWorked: exposure.totalHoursWorked,
    periodLabel,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Trend (multi-period comparison)
// ────────────────────────────────────────────────────────────────────────

export interface PeriodMetrics {
  periodLabel: string;
  metrics: SafetyMetricsReport;
}

export type TrendDirection = 'improving' | 'stable' | 'worsening';

export interface TrendAnalysis {
  metricKey: keyof Omit<SafetyMetricsReport, 'totalHoursWorked' | 'periodLabel'>;
  current: number;
  previous: number;
  deltaPercent: number;
  direction: TrendDirection;
}

const STABLE_THRESHOLD_PERCENT = 5;

/**
 * Compara período actual vs anterior. Direction: improving = bajó
 * (las tasas SST son mejor cuando son menores).
 */
export function analyzeTrend(
  current: SafetyMetricsReport,
  previous: SafetyMetricsReport,
  metricKey: TrendAnalysis['metricKey'],
): TrendAnalysis {
  const cur = current[metricKey];
  const prev = previous[metricKey];
  let deltaPercent = 0;
  if (prev > 0) {
    deltaPercent = Math.round(((cur - prev) / prev) * 100);
  } else if (cur > 0) {
    deltaPercent = 100;
  }
  let direction: TrendDirection = 'stable';
  if (Math.abs(deltaPercent) > STABLE_THRESHOLD_PERCENT) {
    direction = deltaPercent < 0 ? 'improving' : 'worsening';
  }
  return { metricKey, current: cur, previous: prev, deltaPercent, direction };
}
