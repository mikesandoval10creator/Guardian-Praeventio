// Praeventio Guard — Sprint 39 Fase I.6: Top 10 Riesgos + Controles Débiles.
//
// Cierra: Documento usuario "Recomendaciones nuevas §53, §54, §199, §200"
//
// Rankings dinámicos por:
//   - Top 10 riesgos del proyecto (criticidad × frecuencia × incidentes
//     asociados × acciones vencidas × exposición trabajadores)
//   - Top 10 controles débiles (controles que fallan o no se verifican)
//   - Ranking de zonas con más hallazgos
//   - Ranking de tareas con más riesgo

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RiskRecord {
  id: string;
  projectId: string;
  category: string; // 'altura', 'electric', etc.
  severity: RiskSeverity;
  /** Trabajadores expuestos. */
  exposedWorkerCount: number;
  /** Frecuencia detectada en findings recientes. */
  recentFindingCount: number;
  /** Incidentes vinculados (vía edges). */
  linkedIncidentCount: number;
  /** Acciones correctivas asociadas que están vencidas. */
  overdueActionCount: number;
}

export interface ControlRecord {
  id: string;
  projectId: string;
  label: string;
  /** Cuántas veces fue verificado. */
  verificationCount: number;
  /** Veces que falló al verificar. */
  failureCount: number;
  /** Última verificación. */
  lastVerifiedAt?: string;
  /** Días sin verificar. */
  daysSinceLastVerification: number;
}

export interface ZoneStats {
  zoneId: string;
  findingsCount: number;
  incidentsCount: number;
  workersAssigned: number;
}

export interface TaskRiskRecord {
  taskId: string;
  riskCategory: string;
  workersAssigned: number;
  incidentHistory: number;
  /** Si la tarea tiene controles críticos faltantes (de I.2). */
  missingCriticalControls: number;
}

// ────────────────────────────────────────────────────────────────────────
// Score computation
// ────────────────────────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<RiskSeverity, number> = {
  low: 1,
  medium: 3,
  high: 7,
  critical: 12,
};

export function computeRiskScore(r: RiskRecord): number {
  return (
    SEVERITY_WEIGHT[r.severity] * 10 +
    r.recentFindingCount * 5 +
    r.linkedIncidentCount * 8 +
    r.overdueActionCount * 4 +
    Math.min(r.exposedWorkerCount, 50)
  );
}

export function rankRisks(records: RiskRecord[], topN: number = 10): Array<RiskRecord & { score: number }> {
  return records
    .map((r) => ({ ...r, score: computeRiskScore(r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// ────────────────────────────────────────────────────────────────────────
// Weak controls
// ────────────────────────────────────────────────────────────────────────

export interface ControlWeakness {
  controlId: string;
  label: string;
  /** Tasa de falla. */
  failureRate: number;
  /** Si no se verifica hace mucho. */
  isOverdueVerification: boolean;
  /** Score consolidado para ranking. */
  weaknessScore: number;
}

const OVERDUE_VERIFICATION_DAYS = 30;

export function computeControlWeakness(c: ControlRecord): ControlWeakness {
  const failureRate = c.verificationCount === 0 ? 1 : c.failureCount / c.verificationCount;
  const isOverdueVerification = c.daysSinceLastVerification > OVERDUE_VERIFICATION_DAYS;
  // Score: failure rate × 100 + (penalty si overdue 30+ días) + 50 si nunca verificado
  const weaknessScore =
    Math.round(failureRate * 100) +
    (isOverdueVerification ? 30 : 0) +
    (c.verificationCount === 0 ? 50 : 0);
  return {
    controlId: c.id,
    label: c.label,
    failureRate,
    isOverdueVerification,
    weaknessScore,
  };
}

export function rankWeakControls(
  records: ControlRecord[],
  topN: number = 10,
): ControlWeakness[] {
  return records
    .map(computeControlWeakness)
    .sort((a, b) => b.weaknessScore - a.weaknessScore)
    .slice(0, topN);
}

// ────────────────────────────────────────────────────────────────────────
// Zone / Task rankings
// ────────────────────────────────────────────────────────────────────────

export function rankZonesByFindings(
  zones: ZoneStats[],
  topN: number = 10,
): Array<ZoneStats & { score: number }> {
  return zones
    .map((z) => ({
      ...z,
      score: z.findingsCount * 5 + z.incidentsCount * 10 + z.workersAssigned * 2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

export function rankTasksByRisk(
  tasks: TaskRiskRecord[],
  topN: number = 10,
): Array<TaskRiskRecord & { score: number }> {
  return tasks
    .map((t) => ({
      ...t,
      score:
        t.workersAssigned * 2 +
        t.incidentHistory * 8 +
        t.missingCriticalControls * 15,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
