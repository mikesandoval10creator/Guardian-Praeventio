// Praeventio Guard — Sprint 53 §175 (extendido): ROI Scenario Simulator.
//
// Cierra: §175 extendido — multi-scenario comparator de inversiones HSE.
//
// Construye una capa multi-escenario sobre `roiCalculator.ts` (Sprint 51).
// Permite comparar N escenarios de inversión preventiva entre sí, con:
//   - ROI proyectado por escenario (basado en supuestos de impacto).
//   - Sensitivity band ±20% en supuestos.
//   - Score 0-100 (50% ROI, 30% payback, 20% confidence).
//   - Recomendación + rationale.
//
// Determinístico, sin LLM ni I/O. Idempotente.

import type { PreventionCategory } from '../financialAnalytics/roiCalculator.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ScenarioInvestment {
  category: PreventionCategory;
  amountClp: number;
}

export interface ScenarioAssumptions {
  /** % esperado de reducción de incidentes (0-100). */
  expectedIncidentReductionPct: number;
  /** % esperado de mejora de cumplimiento (0-100). */
  expectedComplianceImprovementPct: number;
  /** Estimación inicial de payback en meses. */
  paybackMonthsEstimate: number;
  /** Confianza del equipo en los supuestos. */
  confidenceLevel: ConfidenceLevel;
}

export interface InvestmentScenario {
  id: string;
  name: string;
  description: string;
  /** Inversiones que se harían bajo este escenario. */
  investments: ScenarioInvestment[];
  /** Asunciones de impacto bajo este escenario. */
  assumptions: ScenarioAssumptions;
}

export interface BaselineState {
  /** Costo directo promedio por incidente histórico. */
  averageDirectCostPerIncidentClp: number;
  /** Tasa baseline (incidentes/año sin programa adicional). */
  baselineRatePerYear: number;
  /** Headcount actual. */
  workersCount: number;
  /** Heinrich multiplier (default 4 ratio 1:4). */
  indirectMultiplier: number;
}

export interface SensitivityBand {
  /** ROI% si los supuestos caen 20% peor. */
  roiLowerBound: number;
  /** ROI% si los supuestos mejoran 20%. */
  roiUpperBound: number;
}

export interface ScenarioOutcome {
  scenarioId: string;
  scenarioName: string;
  totalInvestmentClp: number;
  projectedSavingsClp: number;
  projectedRoiPercent: number;
  paybackMonths: number;
  /** Score 0-100 (mayor = mejor opción). */
  recommendationScore: number;
  /** Sensitivity ±20% en assumptions. */
  sensitivityBand: SensitivityBand;
}

export interface ScenarioComparison {
  baseline: BaselineState;
  outcomes: ScenarioOutcome[];
  /** El best scenario por recommendationScore. */
  recommendedScenario: ScenarioOutcome;
  /** Rationale comparativo. */
  rationale: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

function confidenceMultiplier(level: ConfidenceLevel): number {
  // Score factor — high=1.0, medium=0.75, low=0.5.
  if (level === 'high') return 1;
  if (level === 'medium') return 0.75;
  return 0.5;
}

function round1(v: number): number {
  if (!Number.isFinite(v)) return v;
  return Math.round(v * 10) / 10;
}

function sumInvestments(inv: ScenarioInvestment[]): number {
  return inv.reduce((acc, i) => acc + Math.max(0, i.amountClp), 0);
}

/**
 * Calcula proyección savings + ROI para un set de assumptions.
 * No usa computeRoi() directamente porque aquí los supuestos son
 * porcentajes esperados, no tasas comparadas.
 */
function projectOutcome(
  totalInvestmentClp: number,
  baseline: BaselineState,
  assumptions: ScenarioAssumptions,
): { savingsClp: number; roiPercent: number; paybackMonths: number } {
  const reductionPct = clampPct(assumptions.expectedIncidentReductionPct);
  const incidentsAvoidedPerYear =
    baseline.baselineRatePerYear * (reductionPct / 100);
  const directSavings =
    incidentsAvoidedPerYear * baseline.averageDirectCostPerIncidentClp;
  const indirectSavings = directSavings * baseline.indirectMultiplier;
  const savingsClp = Math.round(directSavings + indirectSavings);

  let roiPercent: number;
  if (totalInvestmentClp === 0) {
    roiPercent = savingsClp > 0 ? Number.POSITIVE_INFINITY : 0;
  } else {
    roiPercent = ((savingsClp - totalInvestmentClp) / totalInvestmentClp) * 100;
  }

  let paybackMonths: number;
  if (savingsClp <= 0) {
    paybackMonths = Number.POSITIVE_INFINITY;
  } else {
    paybackMonths = (totalInvestmentClp / savingsClp) * 12;
  }

  return { savingsClp, roiPercent, paybackMonths };
}

/**
 * Sensitivity band: re-calcula ROI con ±20% en los supuestos de impacto.
 */
function computeSensitivityBand(
  totalInvestmentClp: number,
  baseline: BaselineState,
  assumptions: ScenarioAssumptions,
): SensitivityBand {
  const lowReduction = clampPct(
    assumptions.expectedIncidentReductionPct * 0.8,
  );
  const highReduction = clampPct(
    assumptions.expectedIncidentReductionPct * 1.2,
  );

  const low = projectOutcome(totalInvestmentClp, baseline, {
    ...assumptions,
    expectedIncidentReductionPct: lowReduction,
  });
  const high = projectOutcome(totalInvestmentClp, baseline, {
    ...assumptions,
    expectedIncidentReductionPct: highReduction,
  });

  return {
    roiLowerBound: Number.isFinite(low.roiPercent)
      ? round1(low.roiPercent)
      : low.roiPercent,
    roiUpperBound: Number.isFinite(high.roiPercent)
      ? round1(high.roiPercent)
      : high.roiPercent,
  };
}

/**
 * Score 0-100. Factores:
 *   - ROI%       50% peso (normalizado clamp 0-200%→0-100)
 *   - Payback    30% peso (menor = mejor, clamp 0-36m→100-0)
 *   - Confidence 20% peso (low=50, med=75, high=100)
 */
function computeRecommendationScore(
  roiPercent: number,
  paybackMonths: number,
  confidence: ConfidenceLevel,
): number {
  // ROI factor: clamp [-50, 200] → [0, 100].
  let roiScore: number;
  if (!Number.isFinite(roiPercent)) {
    roiScore = roiPercent > 0 ? 100 : 0;
  } else if (roiPercent <= -50) {
    roiScore = 0;
  } else if (roiPercent >= 200) {
    roiScore = 100;
  } else {
    roiScore = ((roiPercent + 50) / 250) * 100;
  }

  // Payback factor: clamp [0, 36m] → [100, 0]. Infinity → 0.
  let paybackScore: number;
  if (!Number.isFinite(paybackMonths)) {
    paybackScore = 0;
  } else if (paybackMonths <= 0) {
    paybackScore = 100;
  } else if (paybackMonths >= 36) {
    paybackScore = 0;
  } else {
    paybackScore = (1 - paybackMonths / 36) * 100;
  }

  // Confidence factor.
  const confidenceScore = confidenceMultiplier(confidence) * 100;

  const composite =
    roiScore * 0.5 + paybackScore * 0.3 + confidenceScore * 0.2;
  return Math.round(Math.max(0, Math.min(100, composite)) * 10) / 10;
}

function evaluateScenario(
  scenario: InvestmentScenario,
  baseline: BaselineState,
): ScenarioOutcome {
  const totalInvestmentClp = sumInvestments(scenario.investments);
  const { savingsClp, roiPercent, paybackMonths } = projectOutcome(
    totalInvestmentClp,
    baseline,
    scenario.assumptions,
  );

  const sensitivityBand = computeSensitivityBand(
    totalInvestmentClp,
    baseline,
    scenario.assumptions,
  );

  const recommendationScore = computeRecommendationScore(
    roiPercent,
    paybackMonths,
    scenario.assumptions.confidenceLevel,
  );

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    totalInvestmentClp,
    projectedSavingsClp: savingsClp,
    projectedRoiPercent: Number.isFinite(roiPercent)
      ? round1(roiPercent)
      : roiPercent,
    paybackMonths: Number.isFinite(paybackMonths)
      ? round1(paybackMonths)
      : paybackMonths,
    recommendationScore,
    sensitivityBand,
  };
}

function buildRationale(
  outcomes: ScenarioOutcome[],
  recommended: ScenarioOutcome,
): string[] {
  const notes: string[] = [];
  notes.push(
    `Escenario recomendado: "${recommended.scenarioName}" con score ${recommended.recommendationScore}/100.`,
  );
  notes.push(
    `ROI proyectado: ${recommended.projectedRoiPercent}%, payback ${recommended.paybackMonths} meses.`,
  );

  if (outcomes.length > 1) {
    const sorted = [...outcomes].sort(
      (a, b) => b.recommendationScore - a.recommendationScore,
    );
    const runnerUp = sorted[1];
    const delta = round1(
      recommended.recommendationScore - runnerUp.recommendationScore,
    );
    notes.push(
      `Ventaja vs runner-up "${runnerUp.scenarioName}": ${delta} puntos de score.`,
    );
  }

  // Sensitivity warning si la banda es muy amplia.
  if (
    Number.isFinite(recommended.sensitivityBand.roiLowerBound) &&
    Number.isFinite(recommended.sensitivityBand.roiUpperBound)
  ) {
    const spread =
      recommended.sensitivityBand.roiUpperBound -
      recommended.sensitivityBand.roiLowerBound;
    if (spread > 100) {
      notes.push(
        `Sensitivity band amplia (${round1(spread)} pts) — supuestos inestables, validar antes de comprometer presupuesto.`,
      );
    }
  }

  if (recommended.recommendationScore < 40) {
    notes.push(
      'Score recomendado <40 — ninguna opción tiene retorno claro, revisar supuestos o ampliar set.',
    );
  }

  return notes;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

export function compareScenarios(
  scenarios: InvestmentScenario[],
  baseline: BaselineState,
): ScenarioComparison {
  if (scenarios.length === 0) {
    throw new Error('compareScenarios requires at least 1 scenario.');
  }

  const outcomes = scenarios.map((s) => evaluateScenario(s, baseline));

  // Recomendar el de mayor recommendationScore (tie-break: ROI mayor, luego payback menor).
  const recommended = [...outcomes].sort((a, b) => {
    if (b.recommendationScore !== a.recommendationScore) {
      return b.recommendationScore - a.recommendationScore;
    }
    const aRoi = Number.isFinite(a.projectedRoiPercent)
      ? a.projectedRoiPercent
      : -Infinity;
    const bRoi = Number.isFinite(b.projectedRoiPercent)
      ? b.projectedRoiPercent
      : -Infinity;
    if (bRoi !== aRoi) return bRoi - aRoi;
    const aPb = Number.isFinite(a.paybackMonths)
      ? a.paybackMonths
      : Infinity;
    const bPb = Number.isFinite(b.paybackMonths)
      ? b.paybackMonths
      : Infinity;
    return aPb - bPb;
  })[0];

  const rationale = buildRationale(outcomes, recommended);

  return {
    baseline,
    outcomes,
    recommendedScenario: recommended,
    rationale,
  };
}
