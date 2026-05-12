// Praeventio Guard — Sprint 39 Fase J.3: Calculadoras de Costo Preventivo.
//
// Cierra: Documento usuario "Recomendaciones nuevas §117, §118"
//
// Dos calculadoras complementarias:
//
//   1. costOfNonCompliance(input) — estima el costo POTENCIAL de
//      no cumplir (multa + paralización + accidente + retraso + rehacer
//      documentación). Útil para justificar inversión preventiva.
//
//   2. preventionROI(input) — estima ahorro real al haber prevenido.
//      Útil para reporte gerencial mensual.
//
// Todos los valores son ESTIMATIONS basados en históricos chilenos +
// SUSESO/DT publicaciones. No reemplazan asesoría legal específica.

// ────────────────────────────────────────────────────────────────────────
// Cost of non-compliance
// ────────────────────────────────────────────────────────────────────────

export type IncompletionKind =
  | 'document_missing'
  | 'training_overdue'
  | 'epp_expired'
  | 'safety_breach'
  | 'fatal_accident_risk';

const FINE_RANGES_CLP: Record<IncompletionKind, { min: number; max: number }> = {
  // Rangos basados en Ley 16.744 + Código del Trabajo art. 477 + DT
  document_missing: { min: 200_000, max: 2_500_000 },
  training_overdue: { min: 500_000, max: 5_000_000 },
  epp_expired: { min: 300_000, max: 3_500_000 },
  safety_breach: { min: 1_000_000, max: 30_000_000 },
  fatal_accident_risk: { min: 10_000_000, max: 500_000_000 },
};

export interface NonComplianceInput {
  /** Tipo de incumplimiento detectado. */
  kind: IncompletionKind;
  /** Cuántos trabajadores afecta. */
  affectedWorkerCount: number;
  /** Días estimados de paralización si fiscaliza. */
  estimatedStoppageDays: number;
  /** Costo diario de paralización (CLP). */
  dailyStoppageCostClp: number;
  /** Horas administrativas para rehacer docs/responder. */
  adminHoursToFix: number;
  /** Costo hora administrativa CLP. */
  adminHourlyCostClp?: number;
  /** Si existe historial de fiscalización previa (aumenta multa). */
  hasHistoryOfFines: boolean;
}

export interface NonComplianceEstimate {
  estimatedFineClpMin: number;
  estimatedFineClpMax: number;
  stoppageCostClp: number;
  adminCostClp: number;
  /** Estimación total mínima. */
  totalEstimatedClpMin: number;
  /** Estimación total máxima. */
  totalEstimatedClpMax: number;
  /** Si historial previo aumenta el rango. */
  historyMultiplier: number;
  notes: string[];
}

export function estimateNonComplianceCost(
  input: NonComplianceInput,
): NonComplianceEstimate {
  const range = FINE_RANGES_CLP[input.kind];
  const multiplier = input.hasHistoryOfFines ? 1.8 : 1.0;
  // Cap a 50 trabajadores → factor 2× (más allá no escala más).
  const workerFactor = 1 + Math.min(input.affectedWorkerCount / 50, 1);
  const fineMin = Math.round(range.min * multiplier * workerFactor);
  const fineMax = Math.round(range.max * multiplier * workerFactor);

  const stoppageCost = input.estimatedStoppageDays * input.dailyStoppageCostClp;
  const hourlyCost = input.adminHourlyCostClp ?? 15_000; // CLP/h default
  const adminCost = input.adminHoursToFix * hourlyCost;

  const notes: string[] = [];
  if (input.hasHistoryOfFines) {
    notes.push('Historial fiscalización previa: multa estimada × 1.8');
  }
  if (input.kind === 'fatal_accident_risk') {
    notes.push('Considerar también demanda civil y daño reputacional');
    notes.push('SUSESO puede aplicar recargo de cotización Ley 16.744');
  }
  if (input.estimatedStoppageDays >= 5) {
    notes.push('Paralización >5 días puede gatillar contrato suspendido con mandante');
  }

  return {
    estimatedFineClpMin: fineMin,
    estimatedFineClpMax: fineMax,
    stoppageCostClp: stoppageCost,
    adminCostClp: adminCost,
    totalEstimatedClpMin: fineMin + stoppageCost + adminCost,
    totalEstimatedClpMax: fineMax + stoppageCost + adminCost,
    historyMultiplier: multiplier,
    notes,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Prevention ROI
// ────────────────────────────────────────────────────────────────────────

export interface PreventionROIInput {
  /** Vencimientos detectados antes de afectar operación. */
  expirationsCaughtEarly: number;
  /** Horas administrativas ahorradas con automatización. */
  adminHoursSaved: number;
  adminHourlyCostClp?: number;
  /** Documentos generados internamente vs comprados a externo. */
  documentsGeneratedInternally: number;
  /** Costo promedio de documento externo CLP. */
  externalDocCostClp?: number;
  /** Cantidad de detenciones potenciales evitadas. */
  potentialStoppagesAvoided: number;
  avgStoppageCostClp?: number;
  /** Incidentes evitados (near-miss que NO escalaron). */
  nearMissesNotEscalated: number;
  /** Costo promedio de incidente menor CLP. */
  avgIncidentCostClp?: number;
}

export interface PreventionROIEstimate {
  adminHoursSavingsClp: number;
  documentInsourceSavingsClp: number;
  stoppageAvoidanceSavingsClp: number;
  incidentAvoidanceSavingsClp: number;
  totalSavingsClp: number;
  /** Items que más contribuyen (ordenados desc). */
  topContributors: Array<{ source: string; amountClp: number; percent: number }>;
}

export function estimatePreventionROI(input: PreventionROIInput): PreventionROIEstimate {
  const hourlyCost = input.adminHourlyCostClp ?? 15_000;
  const docCost = input.externalDocCostClp ?? 80_000;
  const stoppageCost = input.avgStoppageCostClp ?? 800_000;
  const incidentCost = input.avgIncidentCostClp ?? 1_500_000;

  const adminSavings = input.adminHoursSaved * hourlyCost;
  const docSavings = input.documentsGeneratedInternally * docCost;
  const stoppageSavings = input.potentialStoppagesAvoided * stoppageCost;
  const incidentSavings = input.nearMissesNotEscalated * incidentCost;

  const total = adminSavings + docSavings + stoppageSavings + incidentSavings;

  const items: Array<{ source: string; amountClp: number }> = [
    { source: 'Horas administrativas ahorradas', amountClp: adminSavings },
    { source: 'Documentos internos vs externos', amountClp: docSavings },
    { source: 'Detenciones evitadas', amountClp: stoppageSavings },
    { source: 'Incidentes evitados (near-miss)', amountClp: incidentSavings },
  ];
  const topContributors = items
    .filter((i) => i.amountClp > 0)
    .sort((a, b) => b.amountClp - a.amountClp)
    .map((i) => ({
      ...i,
      percent: total === 0 ? 0 : Math.round((i.amountClp / total) * 100),
    }));

  return {
    adminHoursSavingsClp: adminSavings,
    documentInsourceSavingsClp: docSavings,
    stoppageAvoidanceSavingsClp: stoppageSavings,
    incidentAvoidanceSavingsClp: incidentSavings,
    totalSavingsClp: total,
    topContributors,
  };
}
