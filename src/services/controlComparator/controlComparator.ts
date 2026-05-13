// Praeventio Guard — Sprint 52 §193: Comparador de Controles A vs B.
//
// Cierra: Documento usuario "§193 — Comparador de controles".
//
// Compara dos controles desplegados en distintos momentos / áreas /
// proyectos usando series mensuales de datos OHS. Determinístico,
// sin LLM. Complementario al motor existente:
//
//   - `criticalControls/criticalControlsLibrary.ts` define el catálogo.
//   - `criticalControls/controlRobustness.ts` puntúa la robustez
//      jerárquica (elimination > engineering > epp).
//
// Este módulo NO duplica esos: opera sobre series históricas reales
// (incidentes / near-miss / compliance / costo / horas mantención)
// para responder "¿Cuál de los dos funcionó mejor en la práctica?".

import type { ControlLevel } from '../criticalControls/criticalControlsLibrary.js';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type ControlEffectivenessMetric =
  | 'incidents_prevented'
  | 'near_miss_reduction'
  | 'compliance_improvement'
  | 'cost_reduction'
  | 'time_to_implement'
  | 'maintenance_burden';

export interface ControlMonthlyDatapoint {
  /** 'YYYY-MM'. */
  period: string;
  /** Incidentes en el mes antes de desplegar el control (baseline). */
  incidentsBefore?: number;
  /** Incidentes en el mes después de desplegar el control. */
  incidentsAfter: number;
  /** Near-miss reportados en el mes. */
  nearMissCount: number;
  /** Score de cumplimiento normativo 0..100. */
  complianceScore: number;
  /** Costo operacional mensual del control (CLP). */
  operatingCostClp: number;
  /** Horas-hombre de mantención dedicadas al control en el mes. */
  maintenanceHours: number;
}

export interface ControlHistoricalRecord {
  controlId: string;
  controlKind: ControlLevel;
  /** ISO-8601 fecha de despliegue. */
  deployedAt: string;
  /** Serie mensual. */
  monthlyData: ControlMonthlyDatapoint[];
}

export interface MetricResult {
  metric: ControlEffectivenessMetric;
  valueA: number;
  valueB: number;
  /** valueA - valueB (con signo orientado a "más alto = mejor para A"). */
  delta: number;
  /** Delta porcentual respecto a B. */
  deltaPct: number;
  /** Quién gana esta métrica. */
  favors: 'A' | 'B' | 'tie';
}

export interface ControlComparison {
  controlA: ControlHistoricalRecord;
  controlB: ControlHistoricalRecord;
  metricResults: MetricResult[];
  overallFavors: 'A' | 'B' | 'tie';
  /** Score 0-100. 50 = empate, 100 = A claramente mejor, 0 = B claramente mejor. */
  confidenceScore: number;
  /** Recomendación humana legible en español. */
  recommendation: string;
}

// ────────────────────────────────────────────────────────────────────────
// Metric primitives
// ────────────────────────────────────────────────────────────────────────

/** Métricas donde MÁS ALTO = MEJOR (incidentes prevenidos, near-miss
 *  reducidos, mejora compliance, reducción costo). */
const HIGHER_IS_BETTER: Record<ControlEffectivenessMetric, boolean> = {
  incidents_prevented: true,
  near_miss_reduction: true,
  compliance_improvement: true,
  cost_reduction: true,
  // Más bajo es mejor:
  time_to_implement: false,
  maintenance_burden: false,
};

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return sum(arr) / arr.length;
}

/**
 * Calcula incidentes prevenidos = sum(before) - sum(after).
 * Si no hay before, se asume baseline 0 y devuelve 0 (no podemos saber).
 */
export function calcIncidentsPrevented(record: ControlHistoricalRecord): number {
  const beforeTotal = sum(
    record.monthlyData
      .map((d) => d.incidentsBefore)
      .filter((v): v is number => typeof v === 'number'),
  );
  const afterTotal = sum(record.monthlyData.map((d) => d.incidentsAfter));
  // Solo cuenta meses con baseline disponible para fair comparison.
  const monthsWithBefore = record.monthlyData.filter(
    (d) => typeof d.incidentsBefore === 'number',
  ).length;
  if (monthsWithBefore === 0) return 0;
  const afterTotalScoped = sum(
    record.monthlyData
      .filter((d) => typeof d.incidentsBefore === 'number')
      .map((d) => d.incidentsAfter),
  );
  return Math.max(0, beforeTotal - afterTotalScoped);
}

/**
 * Reducción de near-miss = el inverso del promedio (más bajo = mejor en
 * crudo, lo invertimos a "reducción" usando 100 - avg, clamp 0..100).
 */
export function calcNearMissReduction(record: ControlHistoricalRecord): number {
  const a = avg(record.monthlyData.map((d) => d.nearMissCount));
  return Math.max(0, 100 - a);
}

export function calcComplianceImprovement(record: ControlHistoricalRecord): number {
  if (record.monthlyData.length < 2) {
    return avg(record.monthlyData.map((d) => d.complianceScore));
  }
  const first = record.monthlyData[0].complianceScore;
  const last = record.monthlyData[record.monthlyData.length - 1].complianceScore;
  return last - first;
}

/**
 * Reducción de costo: heurística — promedio mensual invertido en escala
 * 0..100 (100 = costo cero, 0 = costo >= 10MM CLP/mes).
 */
export function calcCostReduction(record: ControlHistoricalRecord): number {
  const avgCost = avg(record.monthlyData.map((d) => d.operatingCostClp));
  const TEN_MM = 10_000_000;
  const ratio = Math.min(1, avgCost / TEN_MM);
  return Math.round((1 - ratio) * 100);
}

/**
 * Tiempo de implementación = meses entre deployedAt y el primer datapoint.
 * Más bajo es mejor.
 */
export function calcTimeToImplement(record: ControlHistoricalRecord): number {
  if (record.monthlyData.length === 0) return Infinity;
  const deployed = new Date(record.deployedAt);
  const firstPeriod = record.monthlyData[0].period; // 'YYYY-MM'
  const [year, month] = firstPeriod.split('-').map(Number);
  if (!year || !month) return 0;
  const firstDate = new Date(Date.UTC(year, month - 1, 1));
  const diffMonths =
    (firstDate.getUTCFullYear() - deployed.getUTCFullYear()) * 12 +
    (firstDate.getUTCMonth() - deployed.getUTCMonth());
  return Math.max(0, diffMonths);
}

/** Maintenance burden = horas promedio/mes. */
export function calcMaintenanceBurden(record: ControlHistoricalRecord): number {
  return avg(record.monthlyData.map((d) => d.maintenanceHours));
}

const METRIC_CALCULATORS: Record<
  ControlEffectivenessMetric,
  (r: ControlHistoricalRecord) => number
> = {
  incidents_prevented: calcIncidentsPrevented,
  near_miss_reduction: calcNearMissReduction,
  compliance_improvement: calcComplianceImprovement,
  cost_reduction: calcCostReduction,
  time_to_implement: calcTimeToImplement,
  maintenance_burden: calcMaintenanceBurden,
};

// ────────────────────────────────────────────────────────────────────────
// Comparison
// ────────────────────────────────────────────────────────────────────────

function favorOf(
  valueA: number,
  valueB: number,
  higherIsBetter: boolean,
  tieEpsilon: number,
): 'A' | 'B' | 'tie' {
  if (Math.abs(valueA - valueB) <= tieEpsilon) return 'tie';
  if (higherIsBetter) {
    return valueA > valueB ? 'A' : 'B';
  }
  return valueA < valueB ? 'A' : 'B';
}

function buildMetricResult(
  metric: ControlEffectivenessMetric,
  a: ControlHistoricalRecord,
  b: ControlHistoricalRecord,
): MetricResult {
  const valueA = METRIC_CALCULATORS[metric](a);
  const valueB = METRIC_CALCULATORS[metric](b);
  const higherIsBetter = HIGHER_IS_BETTER[metric];
  const delta = higherIsBetter ? valueA - valueB : valueB - valueA;
  const denom = Math.abs(valueB) < 1e-9 ? 1 : Math.abs(valueB);
  const deltaPct = (delta / denom) * 100;
  // Epsilon: 1% del valor mayor o 0.5 si ambos son chicos.
  const tieEpsilon = Math.max(0.5, Math.max(Math.abs(valueA), Math.abs(valueB)) * 0.01);
  return {
    metric,
    valueA: roundTo(valueA, 2),
    valueB: roundTo(valueB, 2),
    delta: roundTo(delta, 2),
    deltaPct: roundTo(deltaPct, 2),
    favors: favorOf(valueA, valueB, higherIsBetter, tieEpsilon),
  };
}

function roundTo(n: number, digits: number): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

const ALL_METRICS: ControlEffectivenessMetric[] = [
  'incidents_prevented',
  'near_miss_reduction',
  'compliance_improvement',
  'cost_reduction',
  'time_to_implement',
  'maintenance_burden',
];

function buildRecommendation(
  a: ControlHistoricalRecord,
  b: ControlHistoricalRecord,
  metricResults: MetricResult[],
  overall: 'A' | 'B' | 'tie',
  confidenceScore: number,
): string {
  if (overall === 'tie') {
    return `Empate técnico entre ${a.controlId} y ${b.controlId}. Ambos controles muestran efectividad comparable; considera factores cualitativos (aceptación trabajadores, robustez jerárquica) para decidir.`;
  }
  const winnerId = overall === 'A' ? a.controlId : b.controlId;
  const loserId = overall === 'A' ? b.controlId : a.controlId;
  const winnerMetrics = metricResults.filter((m) => m.favors === overall).map((m) => m.metric);
  const confidenceLabel =
    confidenceScore >= 75 || confidenceScore <= 25
      ? 'alta confianza'
      : confidenceScore >= 60 || confidenceScore <= 40
        ? 'confianza moderada'
        : 'baja confianza';
  return `Recomendamos ${winnerId} sobre ${loserId} (${confidenceLabel}, score=${confidenceScore}/100). Ventajas en: ${winnerMetrics.join(', ')}.`;
}

/**
 * Compara dos controles A y B y devuelve un análisis estructurado.
 *
 * El `confidenceScore` se calcula como:
 *   - 50 base (empate)
 *   - +/- por cada métrica que favorezca A o B, ponderada por magnitud
 *     del delta relativo (clamp 0..100)
 */
export function compareControls(
  controlA: ControlHistoricalRecord,
  controlB: ControlHistoricalRecord,
): ControlComparison {
  const metricResults = ALL_METRICS.map((m) => buildMetricResult(m, controlA, controlB));

  // Confidence: punto por métrica, peso por |deltaPct| clampada.
  let score = 50;
  for (const m of metricResults) {
    if (m.favors === 'tie') continue;
    const weight = Math.min(10, Math.abs(m.deltaPct) / 10); // 0..10
    score += m.favors === 'A' ? weight : -weight;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let overallFavors: 'A' | 'B' | 'tie';
  if (score >= 55) overallFavors = 'A';
  else if (score <= 45) overallFavors = 'B';
  else overallFavors = 'tie';

  const recommendation = buildRecommendation(
    controlA,
    controlB,
    metricResults,
    overallFavors,
    score,
  );

  return {
    controlA,
    controlB,
    metricResults,
    overallFavors,
    confidenceScore: score,
    recommendation,
  };
}
