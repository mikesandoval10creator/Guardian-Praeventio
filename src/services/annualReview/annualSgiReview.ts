// Praeventio Guard — Sprint K: Revisión Anual del Sistema de Gestión.
//
// Cierra: Documento usuario "§291-295"
//
// Flujo guiado anual:
//   - Revisar políticas
//   - Revisar objetivos
//   - Revisar indicadores
//   - Revisar incidentes
//   - Revisar auditorías
//   - Definir plan del año siguiente
//
// Cada objetivo preventivo tiene:
//   - Métrica medible (no decorativa)
//   - Acciones concretas asociadas
//   - Evidencias de avance
//
// Determinístico. Sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Objectives (§292-295)
// ────────────────────────────────────────────────────────────────────────

export type ObjectiveMetric =
  | 'count_reduction'           // ej: reducir incidentes en X
  | 'count_increase'            // ej: aumentar reportes preventivos en X
  | 'percent_completion'        // ej: completar 95% de charlas críticas
  | 'percent_reduction';        // ej: reducir vencidos en 30%

export interface PreventiveObjective {
  id: string;
  fiscalYear: number;
  title: string;
  description: string;
  metric: ObjectiveMetric;
  /** Baseline (valor al iniciar el año). */
  baseline: number;
  /** Target (valor objetivo). */
  target: number;
  /** Valor actual (medido). */
  currentValue: number;
  /** ISO-8601 deadline (ej: 2026-12-31). */
  deadline: string;
  /** UID del responsable principal. */
  ownerUid: string;
  /** Status. */
  status: 'planned' | 'in_progress' | 'on_track' | 'at_risk' | 'achieved' | 'missed';
  /** Acciones concretas vinculadas (§294). */
  linkedActionIds: string[];
  /** Evidencias de avance (§295). */
  evidenceUrls: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Progress computation
// ────────────────────────────────────────────────────────────────────────

export interface ObjectiveProgress {
  objectiveId: string;
  /** % de avance entre baseline y target. */
  progressPercent: number;
  /** True si se cumplió. */
  isAchieved: boolean;
  /** Si no se cumplió, días restantes. Negativo si vencido. */
  daysRemaining: number;
  /** True si va camino al éxito (tiempo proporcional al avance). */
  isOnTrack: boolean;
  /** Status sugerido. */
  suggestedStatus: PreventiveObjective['status'];
}

/**
 * Calcula progreso normalizado en función del tipo de métrica.
 * Para `reduction` el progreso es (baseline - current) / (baseline - target).
 * Para `increase` es (current - baseline) / (target - baseline).
 */
function computeRawProgress(obj: PreventiveObjective): number {
  const span = obj.target - obj.baseline;
  if (span === 0) return obj.currentValue === obj.target ? 1 : 0;
  const traveled = obj.currentValue - obj.baseline;
  return Math.max(0, Math.min(1, traveled / span));
}

export function computeObjectiveProgress(
  obj: PreventiveObjective,
  nowIso: string = new Date().toISOString(),
): ObjectiveProgress {
  const rawProgress = computeRawProgress(obj);
  const progressPercent = Math.round(rawProgress * 100);
  const isAchieved = rawProgress >= 1;
  const deadlineMs = Date.parse(obj.deadline);
  const nowMs = Date.parse(nowIso);
  const daysRemaining = Math.floor((deadlineMs - nowMs) / 86_400_000);

  // ¿on track? — el avance % debe ser >= % de año transcurrido
  const yearStart = Date.parse(`${obj.fiscalYear}-01-01T00:00:00Z`);
  const yearEnd = Date.parse(`${obj.fiscalYear}-12-31T23:59:59Z`);
  const yearElapsed = Math.max(0, Math.min(1, (nowMs - yearStart) / (yearEnd - yearStart)));
  const isOnTrack = isAchieved || rawProgress + 0.1 >= yearElapsed; // 10% de tolerancia

  let suggestedStatus: PreventiveObjective['status'];
  if (isAchieved) suggestedStatus = 'achieved';
  else if (daysRemaining < 0) suggestedStatus = 'missed';
  else if (isOnTrack) suggestedStatus = 'on_track';
  else suggestedStatus = 'at_risk';

  return {
    objectiveId: obj.id,
    progressPercent,
    isAchieved,
    daysRemaining,
    isOnTrack,
    suggestedStatus,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Objective validation (§294)
// ────────────────────────────────────────────────────────────────────────

export interface ObjectiveValidationIssue {
  issue: 'no_linked_actions' | 'no_evidence_yet' | 'unrealistic_target' | 'past_deadline_pending';
  description: string;
}

export function validateObjective(
  obj: PreventiveObjective,
  nowIso: string = new Date().toISOString(),
): ObjectiveValidationIssue[] {
  const issues: ObjectiveValidationIssue[] = [];

  if (obj.linkedActionIds.length === 0 && obj.status !== 'planned') {
    issues.push({
      issue: 'no_linked_actions',
      description: 'Objetivo sin acciones vinculadas → es decorativo. Define al menos 1 acción concreta.',
    });
  }
  if (obj.evidenceUrls.length === 0 && obj.status === 'in_progress') {
    issues.push({
      issue: 'no_evidence_yet',
      description: 'Objetivo "in_progress" sin evidencia subida. Documenta avance periódicamente.',
    });
  }
  const isReduction = obj.metric.includes('reduction');
  if (isReduction && obj.target >= obj.baseline) {
    issues.push({
      issue: 'unrealistic_target',
      description: 'Target de reducción no es menor que baseline.',
    });
  }
  const isIncrease = obj.metric.includes('increase') || obj.metric === 'percent_completion';
  if (isIncrease && obj.target <= obj.baseline) {
    issues.push({
      issue: 'unrealistic_target',
      description: 'Target de aumento no es mayor que baseline.',
    });
  }
  if (Date.parse(obj.deadline) < Date.parse(nowIso) && obj.status !== 'achieved' && obj.status !== 'missed') {
    issues.push({
      issue: 'past_deadline_pending',
      description: 'Deadline vencido pero objetivo aún no marcado como achieved/missed.',
    });
  }

  return issues;
}

// ────────────────────────────────────────────────────────────────────────
// Annual review report
// ────────────────────────────────────────────────────────────────────────

export interface AnnualReviewReport {
  fiscalYear: number;
  totalObjectives: number;
  achieved: number;
  onTrack: number;
  atRisk: number;
  missed: number;
  achievementRate: number; // %
  topPerformers: PreventiveObjective[];
  needsAttention: PreventiveObjective[];
}

export function buildAnnualReview(
  objectives: PreventiveObjective[],
  fiscalYear: number,
  nowIso: string = new Date().toISOString(),
): AnnualReviewReport {
  const own = objectives.filter((o) => o.fiscalYear === fiscalYear);
  let achieved = 0;
  let onTrack = 0;
  let atRisk = 0;
  let missed = 0;

  const enriched = own.map((o) => {
    const progress = computeObjectiveProgress(o, nowIso);
    if (progress.suggestedStatus === 'achieved') achieved += 1;
    else if (progress.suggestedStatus === 'on_track') onTrack += 1;
    else if (progress.suggestedStatus === 'at_risk') atRisk += 1;
    else if (progress.suggestedStatus === 'missed') missed += 1;
    return { obj: o, progress };
  });

  const topPerformers = enriched
    .filter((e) => e.progress.isAchieved)
    .sort((a, b) => b.progress.progressPercent - a.progress.progressPercent)
    .map((e) => e.obj)
    .slice(0, 5);

  const needsAttention = enriched
    .filter((e) => e.progress.suggestedStatus === 'at_risk' || e.progress.suggestedStatus === 'missed')
    .map((e) => e.obj);

  const achievementRate = own.length > 0 ? Math.round((achieved / own.length) * 100) : 0;

  return {
    fiscalYear,
    totalObjectives: own.length,
    achieved,
    onTrack,
    atRisk,
    missed,
    achievementRate,
    topPerformers,
    needsAttention,
  };
}
