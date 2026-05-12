// Praeventio Guard — Sprint K: Safety Performance Index (SPI) + leading/lagging KPIs.
//
// Cierra: Documento usuario "§197-198"
//
// Combina indicadores leading (preventivos, anticipan) y lagging
// (reactivos, miden lo que ya pasó) en un solo score interpretable
// para gerencia. Determinístico, ponderado por ISO 45001.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface LeadingIndicators {
  /** % de checklists pre-tarea completados. */
  preTaskChecklistCompletion: number;
  /** Charlas diarias ejecutadas / planificadas. */
  dailyTalksDeliveryRate: number;
  /** Capacitaciones vigentes / total trabajadores. */
  trainingCurrencyRate: number;
  /** Inspecciones planificadas ejecutadas. */
  plannedInspectionsRate: number;
  /** Reportes de near-miss / mes (mayor = mejor cultura). */
  nearMissReportingRate: number;
  /** Observaciones positivas / mes (mayor = mejor cultura). */
  positiveObservationsRate: number;
}

export interface LaggingIndicators {
  /** TRIR (recordable incident rate). */
  trir: number;
  /** LTIFR (lost time injury frequency). */
  ltifr: number;
  /** Días perdidos en el período. */
  lostDays: number;
  /** Severidad de incidentes. */
  severityRate: number;
  /** Multas / no conformidades regulatorias. */
  regulatoryFindings: number;
}

// ────────────────────────────────────────────────────────────────────────
// Score computation
// ────────────────────────────────────────────────────────────────────────

export interface SafetyPerformanceReport {
  /** Score 0-100 (mayor = mejor desempeño). */
  spiScore: number;
  /** Componente leading 0-100. */
  leadingScore: number;
  /** Componente lagging 0-100. */
  laggingScore: number;
  level: 'critical' | 'poor' | 'fair' | 'good' | 'excellent';
  /** Top 3 mejoras sugeridas. */
  improvementFocusAreas: string[];
}

function normalizeRate(value: number): number {
  // value 0-1 → 0-100
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function laggingPenalty(value: number, scaleMax: number): number {
  // 0 → 100, scaleMax o más → 0
  return Math.max(0, Math.round(100 - (value / scaleMax) * 100));
}

export function computeSafetyPerformance(
  leading: LeadingIndicators,
  lagging: LaggingIndicators,
): SafetyPerformanceReport {
  // Leading: avg de 6 métricas normalizadas
  const leadingValues = [
    normalizeRate(leading.preTaskChecklistCompletion),
    normalizeRate(leading.dailyTalksDeliveryRate),
    normalizeRate(leading.trainingCurrencyRate),
    normalizeRate(leading.plannedInspectionsRate),
    normalizeRate(Math.min(1, leading.nearMissReportingRate / 10)),
    normalizeRate(Math.min(1, leading.positiveObservationsRate / 10)),
  ];
  const leadingScore = Math.round(leadingValues.reduce((s, v) => s + v, 0) / leadingValues.length);

  // Lagging: penalty inverso (TRIR 5+ malo, LTIFR 10+ malo, etc.)
  const laggingComponents = [
    laggingPenalty(lagging.trir, 5),
    laggingPenalty(lagging.ltifr, 10),
    laggingPenalty(lagging.lostDays, 100),
    laggingPenalty(lagging.severityRate, 1000),
    laggingPenalty(lagging.regulatoryFindings, 10),
  ];
  const laggingScore = Math.round(
    laggingComponents.reduce((s, v) => s + v, 0) / laggingComponents.length,
  );

  // SPI: pondera leading 40% + lagging 60% (lagging pesa más por consecuencias reales)
  const spiScore = Math.round(leadingScore * 0.4 + laggingScore * 0.6);

  let level: SafetyPerformanceReport['level'];
  if (spiScore >= 90) level = 'excellent';
  else if (spiScore >= 75) level = 'good';
  else if (spiScore >= 60) level = 'fair';
  else if (spiScore >= 40) level = 'poor';
  else level = 'critical';

  // Improvement focus: peor componente leading
  const labels = [
    { name: 'Checklists pre-tarea', score: leadingValues[0] },
    { name: 'Charlas diarias', score: leadingValues[1] },
    { name: 'Capacitaciones vigentes', score: leadingValues[2] },
    { name: 'Inspecciones planificadas', score: leadingValues[3] },
    { name: 'Reportes near-miss', score: leadingValues[4] },
    { name: 'Observaciones positivas', score: leadingValues[5] },
  ];
  const improvementFocusAreas = labels
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((l) => `${l.name} (${l.score}/100)`);

  return {
    spiScore,
    leadingScore,
    laggingScore,
    level,
    improvementFocusAreas,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Trend over periods
// ────────────────────────────────────────────────────────────────────────

export interface SpiPeriodPoint {
  periodLabel: string;
  spiScore: number;
}

export interface SpiTrendReport {
  points: SpiPeriodPoint[];
  /** Tendencia general. */
  trend: 'improving' | 'stable' | 'declining';
  /** % cambio respecto al primer punto. */
  percentChange: number;
}

export function buildSpiTrend(points: SpiPeriodPoint[]): SpiTrendReport {
  if (points.length === 0) {
    return { points: [], trend: 'stable', percentChange: 0 };
  }
  const first = points[0].spiScore;
  const last = points[points.length - 1].spiScore;
  const percentChange = first === 0 ? 0 : Math.round(((last - first) / first) * 100);
  let trend: 'improving' | 'stable' | 'declining';
  if (percentChange >= 5) trend = 'improving';
  else if (percentChange <= -5) trend = 'declining';
  else trend = 'stable';
  return { points, trend, percentChange };
}
