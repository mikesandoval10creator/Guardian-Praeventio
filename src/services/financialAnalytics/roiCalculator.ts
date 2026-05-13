// Praeventio Guard — Sprint 51 §175 + §178: ROI Calculator.
//
// Cierra: Documento usuario "2da tanda recomendaciones §175 + §178".
//
// Calcula retorno sobre inversión preventiva comparando:
//   - Inversión total (training, EPP, ingeniería, controles, auditorías)
//   - Ahorro estimado por incidentes evitados (directo + indirecto)
//
// Heinrich ratio 1:4 — por cada peso de costo DIRECTO de un incidente
// (atención médica, indemnización, daño material), existen ~4 pesos de
// costo INDIRECTO (productividad perdida, reemplazo, capacitación de
// reemplazo, investigación, daño reputacional). Default multiplier=4.
//
// Determinístico, sin LLM ni I/O.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type PreventionCategory =
  | 'training'
  | 'epp'
  | 'engineering'
  | 'controls'
  | 'audits';

export interface PreventionInvestment {
  category: PreventionCategory;
  amountClp: number;
}

export interface AvoidedIncidentEstimate {
  /** Tasa de incidentes baseline (antes del programa). */
  baselineRatePerYear: number;
  /** Tasa actual con el programa preventivo. */
  currentRatePerYear: number;
  /** Costo promedio directo por incidente (atención, daño, indemnización). */
  averageDirectCostPerIncidentClp: number;
  /** Heinrich ratio — indirectos vs directos. Default 4. */
  indirectMultiplier?: number;
}

export interface RoiReport {
  totalInvestmentClp: number;
  incidentsAvoidedPerYear: number;
  directSavingsClp: number;
  indirectSavingsClp: number;
  totalSavingsClp: number;
  /** (savings - investment) / investment * 100. */
  roiPercent: number;
  /** Meses estimados hasta recuperar la inversión. Infinity si savings <= 0. */
  paybackMonths: number;
  verdict: 'profitable' | 'breakeven' | 'loss';
  notes: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

function classifyVerdict(roiPercent: number): RoiReport['verdict'] {
  if (roiPercent > 10) return 'profitable';
  if (roiPercent >= -10) return 'breakeven';
  return 'loss';
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

export function computeRoi(
  investments: PreventionInvestment[],
  avoided: AvoidedIncidentEstimate,
): RoiReport {
  const notes: string[] = [];

  // 1. Total inversión.
  const totalInvestmentClp = investments.reduce(
    (acc, inv) => acc + Math.max(0, inv.amountClp),
    0,
  );

  // 2. Incidentes evitados por año.
  const incidentsAvoidedPerYear = Math.max(
    0,
    avoided.baselineRatePerYear - avoided.currentRatePerYear,
  );
  if (incidentsAvoidedPerYear === 0) {
    notes.push('No hay reducción de incidentes vs baseline.');
  }

  // 3. Ahorros directos e indirectos (Heinrich 1:4).
  const directSavingsClp = Math.round(
    incidentsAvoidedPerYear * avoided.averageDirectCostPerIncidentClp,
  );
  const indirectMultiplier = avoided.indirectMultiplier ?? 4;
  const indirectSavingsClp = Math.round(directSavingsClp * indirectMultiplier);
  const totalSavingsClp = directSavingsClp + indirectSavingsClp;

  if (indirectMultiplier !== 4) {
    notes.push(
      `Heinrich multiplier custom ${indirectMultiplier} (default 4 ratio 1:4).`,
    );
  }

  // 4. ROI %.
  let roiPercent: number;
  if (totalInvestmentClp === 0) {
    roiPercent = totalSavingsClp > 0 ? Number.POSITIVE_INFINITY : 0;
    notes.push('Inversión 0 → ROI no calculable como porcentaje finito.');
  } else {
    roiPercent =
      ((totalSavingsClp - totalInvestmentClp) / totalInvestmentClp) * 100;
  }

  // 5. Payback en meses.
  let paybackMonths: number;
  if (totalSavingsClp <= 0) {
    paybackMonths = Number.POSITIVE_INFINITY;
  } else {
    paybackMonths = (totalInvestmentClp / totalSavingsClp) * 12;
  }

  const verdict = classifyVerdict(roiPercent);

  return {
    totalInvestmentClp,
    incidentsAvoidedPerYear,
    directSavingsClp,
    indirectSavingsClp,
    totalSavingsClp,
    roiPercent: Number.isFinite(roiPercent)
      ? Math.round(roiPercent * 10) / 10
      : roiPercent,
    paybackMonths: Number.isFinite(paybackMonths)
      ? Math.round(paybackMonths * 10) / 10
      : paybackMonths,
    verdict,
    notes,
  };
}

// ────────────────────────────────────────────────────────────────────────
// §178 — Costos directos vs indirectos (Heinrich)
// ────────────────────────────────────────────────────────────────────────

export interface HeinrichBreakdown {
  directCostClp: number;
  indirectCostClp: number;
  totalCostClp: number;
  ratio: number;
}

/**
 * Aplica el iceberg de Heinrich a un costo directo conocido.
 * Útil cuando solo se tiene el costo directo registrado y se quiere
 * estimar el costo TOTAL real del incidente.
 */
export function applyHeinrichRatio(
  directCostClp: number,
  indirectMultiplier = 4,
): HeinrichBreakdown {
  const safeDirect = Math.max(0, directCostClp);
  const indirectCostClp = Math.round(safeDirect * indirectMultiplier);
  return {
    directCostClp: Math.round(safeDirect),
    indirectCostClp,
    totalCostClp: Math.round(safeDirect) + indirectCostClp,
    ratio: indirectMultiplier,
  };
}

// ────────────────────────────────────────────────────────────────────────
// §179 — Benchmark industria
// ────────────────────────────────────────────────────────────────────────

export interface IndustryBenchmark {
  /** Costo promedio en CLP por trabajador/año para esa industria. */
  industryAvgCostPerWorkerPerYearClp: number;
  industryName: string;
}

export interface BenchmarkComparison {
  ourCostPerWorkerPerYearClp: number;
  industryAvgCostPerWorkerPerYearClp: number;
  deltaClp: number;
  deltaPct: number;
  verdict: 'better_than_industry' | 'on_par' | 'worse_than_industry';
  notes: string[];
}

export function compareToBenchmark(
  ourAnnualCostClp: number,
  workersCount: number,
  benchmark: IndustryBenchmark,
): BenchmarkComparison {
  const notes: string[] = [];
  if (workersCount <= 0) {
    notes.push('workersCount<=0 → cálculo no válido, retorna 0.');
    return {
      ourCostPerWorkerPerYearClp: 0,
      industryAvgCostPerWorkerPerYearClp:
        benchmark.industryAvgCostPerWorkerPerYearClp,
      deltaClp: 0,
      deltaPct: 0,
      verdict: 'on_par',
      notes,
    };
  }

  const ourPerWorker = Math.round(ourAnnualCostClp / workersCount);
  const deltaClp = ourPerWorker - benchmark.industryAvgCostPerWorkerPerYearClp;
  const deltaPct =
    benchmark.industryAvgCostPerWorkerPerYearClp === 0
      ? 0
      : (deltaClp / benchmark.industryAvgCostPerWorkerPerYearClp) * 100;

  let verdict: BenchmarkComparison['verdict'];
  if (deltaPct < -5) verdict = 'better_than_industry';
  else if (deltaPct <= 5) verdict = 'on_par';
  else verdict = 'worse_than_industry';

  notes.push(`Comparado vs benchmark "${benchmark.industryName}".`);

  return {
    ourCostPerWorkerPerYearClp: ourPerWorker,
    industryAvgCostPerWorkerPerYearClp:
      benchmark.industryAvgCostPerWorkerPerYearClp,
    deltaClp,
    deltaPct: Math.round(deltaPct * 10) / 10,
    verdict,
    notes,
  };
}
