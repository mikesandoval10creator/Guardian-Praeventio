// Praeventio Guard — Sprint K: KPI Contratistas + Ranking + Acreditación.
//
// Cierra: Documento usuario "§90-91, §47-48"
//
// Trackea desempeño preventivo de contratistas + estado de acreditación:
//   - KPIs por contratista (incidentes, TRIR, LTIFR, compliance)
//   - Ranking por riesgo
//   - Estado de acreditación con observaciones
//   - Plazos de subsanación
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ContractorPerformance {
  contractorId: string;
  legalName: string;
  /** Días trabajados acumulados período. */
  manDaysWorked: number;
  /** Horas hombre trabajadas. */
  manHoursWorked: number;
  /** Incidentes registrables. */
  recordableIncidents: number;
  /** Días perdidos por accidentes con tiempo perdido. */
  lostTimeDays: number;
  /** Acciones correctivas vencidas. */
  overdueActions: number;
  /** Capacitaciones obligatorias completadas % (0-1). */
  trainingCompletionRate: number;
  /** Documentación vigente % (0-1). */
  documentationCurrentRate: number;
}

// ────────────────────────────────────────────────────────────────────────
// KPI calculation (industry-standard rates)
// ────────────────────────────────────────────────────────────────────────

export interface ContractorKpi {
  contractorId: string;
  /** Total Recordable Incident Rate = (incidentes × 200,000) / horas hombre. */
  trir: number;
  /** Lost Time Injury Frequency Rate = (LTI × 1,000,000) / horas hombre. */
  ltifr: number;
  /** Severity rate (días perdidos × 1,000,000 / horas). */
  severityRate: number;
  /** Score compliance combinado (0-100). */
  complianceScore: number;
  /** Riesgo combinado (0-100, mayor = peor). */
  riskScore: number;
  level: 'green' | 'yellow' | 'orange' | 'red';
}

export function computeContractorKpi(perf: ContractorPerformance): ContractorKpi {
  const trir =
    perf.manHoursWorked > 0
      ? Math.round((perf.recordableIncidents * 200_000) / perf.manHoursWorked * 100) / 100
      : 0;
  const ltifr =
    perf.manHoursWorked > 0
      ? Math.round((perf.recordableIncidents * 1_000_000) / perf.manHoursWorked * 100) / 100
      : 0;
  const severityRate =
    perf.manHoursWorked > 0
      ? Math.round((perf.lostTimeDays * 1_000_000) / perf.manHoursWorked * 100) / 100
      : 0;

  // Compliance: promedio ponderado training × docs
  const complianceScore = Math.round(
    (perf.trainingCompletionRate * 50 + perf.documentationCurrentRate * 50),
  );

  // Risk: combina TRIR + overdue + compliance gap
  let riskScore = 0;
  riskScore += Math.min(50, trir * 5); // TRIR aporta hasta 50
  riskScore += Math.min(30, perf.overdueActions * 3); // hasta 30
  riskScore += Math.max(0, (100 - complianceScore) / 5); // hasta 20
  riskScore = Math.min(100, Math.round(riskScore));

  let level: 'green' | 'yellow' | 'orange' | 'red';
  if (riskScore >= 75) level = 'red';
  else if (riskScore >= 50) level = 'orange';
  else if (riskScore >= 25) level = 'yellow';
  else level = 'green';

  return {
    contractorId: perf.contractorId,
    trir,
    ltifr,
    severityRate,
    complianceScore,
    riskScore,
    level,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Ranking (§91)
// ────────────────────────────────────────────────────────────────────────

export interface ContractorRankEntry {
  contractorId: string;
  legalName: string;
  riskScore: number;
  level: ContractorKpi['level'];
  trir: number;
}

export function rankContractorsByRisk(
  perfs: ContractorPerformance[],
): ContractorRankEntry[] {
  return perfs
    .map((p) => {
      const kpi = computeContractorKpi(p);
      return {
        contractorId: p.contractorId,
        legalName: p.legalName,
        riskScore: kpi.riskScore,
        level: kpi.level,
        trir: kpi.trir,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

// ────────────────────────────────────────────────────────────────────────
// Injury-rate ranking from REAL server performance rows
// ────────────────────────────────────────────────────────────────────────
//
// The server endpoint `GET /api/sprint-k/:projectId/contractors/performance`
// (src/server/routes/contractors.ts) returns per-contractor TRIR/LTIFR/severity
// computed SERVER-SIDE from REAL incidents carrying a `contractorId` + the
// captured man-hours. That payload does NOT carry compliance/overdue-action
// signals, so we rank ONLY on what is real: the injury rates. We deliberately
// do NOT fabricate `trainingCompletionRate`/`documentationCurrentRate`/
// `overdueActions` to feed `computeContractorKpi` — that would invent a
// "perfect compliance" score and lie about the contractor's true standing.

/** Minimal real shape consumed from the server performance row. */
export interface ContractorInjuryRates {
  contractorId: string;
  contractorName: string;
  /** Total Recordable Incident Rate (OSHA 200k base), server-computed. */
  trir: number;
  /** Severity rate (lost days × 1,000,000 / hours), server-computed. */
  severityRate: number;
}

/**
 * Maps real per-contractor injury rates into a risk band + rank entry.
 * `riskScore` (0-100) is derived ONLY from real TRIR + severity — higher is
 * worse. Bands mirror `computeContractorKpi`'s thresholds so the same legend
 * applies across both views.
 */
export function rankContractorRowsByInjuryRate(
  rows: ContractorInjuryRates[],
): ContractorRankEntry[] {
  return rows
    .map((r) => {
      // TRIR contributes up to 60, severity up to 40 — both from real data.
      let riskScore = 0;
      riskScore += Math.min(60, r.trir * 6);
      riskScore += Math.min(40, r.severityRate / 100);
      riskScore = Math.min(100, Math.round(riskScore));

      let level: ContractorKpi['level'];
      if (riskScore >= 75) level = 'red';
      else if (riskScore >= 50) level = 'orange';
      else if (riskScore >= 25) level = 'yellow';
      else level = 'green';

      return {
        contractorId: r.contractorId,
        legalName: r.contractorName,
        riskScore,
        level,
        trir: Math.round(r.trir * 100) / 100,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

// ────────────────────────────────────────────────────────────────────────
// Acreditación (§47-48)
// ────────────────────────────────────────────────────────────────────────

export type AcreditationStatus = 'pending' | 'in_review' | 'approved' | 'observed' | 'rejected';

export interface AcreditationRecord {
  contractorId: string;
  status: AcreditationStatus;
  /** Observaciones del mandante. */
  observations: Array<{
    id: string;
    issue: string;
    /** Plazo para subsanar (ISO-8601). */
    dueAt: string;
    /** Si está subsanado. */
    resolved: boolean;
    resolvedAt?: string;
  }>;
  /** ISO-8601 de la última revisión. */
  lastReviewedAt?: string;
}

export interface AcreditationGapReport {
  contractorId: string;
  totalObservations: number;
  resolved: number;
  pending: number;
  overdue: number;
  /** True si puede operar en faena (status='approved' + 0 overdue). */
  canOperate: boolean;
}

export function buildAcreditationGapReport(
  record: AcreditationRecord,
  nowIso: string = new Date().toISOString(),
): AcreditationGapReport {
  const nowMs = Date.parse(nowIso);
  const resolved = record.observations.filter((o) => o.resolved).length;
  const pending = record.observations.filter((o) => !o.resolved).length;
  const overdue = record.observations.filter(
    (o) => !o.resolved && Date.parse(o.dueAt) < nowMs,
  ).length;
  const canOperate = record.status === 'approved' && overdue === 0;
  return {
    contractorId: record.contractorId,
    totalObservations: record.observations.length,
    resolved,
    pending,
    overdue,
    canOperate,
  };
}
