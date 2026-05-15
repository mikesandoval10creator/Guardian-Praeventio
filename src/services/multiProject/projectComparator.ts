// Praeventio Guard — Sprint 41 Fase F.27: Comparador entre Proyectos.
//
// Cierra Plan F.27 "Comparador entre Proyectos (vista multi-proyecto
// tier Empresa)".
//
// Compara métricas SST clave entre N proyectos del tenant para
// identificar mejores prácticas + proyectos en riesgo. Salida directa
// a dashboard ejecutivo.
//
// 100% determinístico. Sin LLM. Reusa cálculos de safety-metrics/osha.

import {
  calculateTrir,
  calculateLtifr,
  type IncidentCounts,
  type ExposureInput,
} from '../safetyMetrics/osha.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ProjectSnapshot {
  projectId: string;
  projectName: string;
  industry?: string;
  workersCount: number;
  totalHoursWorked: number;
  incidents: IncidentCounts;
  /** Score semáforo cumplimiento 0-100 (F.2). */
  complianceTrafficLightScore: number;
  /** % de trainings al día (sobre el total requerido). */
  trainingCoverage: number;
  /** % de EPP con vencimiento al día. */
  eppCoverage: number;
  /** Acciones correctivas abiertas (F.4). */
  openCorrectiveActions: number;
  /** Acciones correctivas cerradas en el período. */
  closedCorrectiveActions: number;
  /** Días desde último incidente reportado (mayor = mejor). */
  daysSinceLastIncident: number;
}

export interface ProjectMetricScore {
  projectId: string;
  projectName: string;
  trir: number;
  ltifr: number;
  complianceTrafficLightScore: number;
  trainingCoverage: number;
  eppCoverage: number;
  /** Closure rate F.4. null si no hay acciones (no premiar ausencia). */
  correctiveActionClosureRate: number | null;
  daysSinceLastIncident: number;
  /** Codex P2 PR #103: preservar SIF/fatality counts para risk flagging
   *  (no se infieren de TRIR — pueden no aparecer en rate y aún ser críticos). */
  seriousInjuriesAndFatalities: number;
  fatalities: number;
  /** Score global 0-100 (más alto = mejor performance SST). */
  overallScore: number;
}

export interface ComparisonReport {
  scores: ProjectMetricScore[];
  /** Best performer overall. */
  topProject: ProjectMetricScore | null;
  /** Project más en riesgo. */
  worstProject: ProjectMetricScore | null;
  /** Promedio por métrica. */
  averages: {
    trir: number;
    ltifr: number;
    compliance: number;
    trainingCoverage: number;
    eppCoverage: number;
    overallScore: number;
    /** Codex P2 PR #103: avg closure rate (excluyendo null) para
     *  comparación en best-practice extraction. */
    closureRate: number;
  };
  /** Proyectos cuyo TRIR está >2× el promedio = outliers. */
  trirOutliers: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Score derivation
// ────────────────────────────────────────────────────────────────────────

/**
 * Combina métricas en un score 0-100. Pondera:
 *   30% compliance traffic light
 *   20% training coverage
 *   15% epp coverage
 *   15% closure rate corrective actions
 *   10% TRIR inverso (TRIR bajo = score alto)
 *   10% días sin incidente (cap 365d)
 */
function computeOverallScore(score: Omit<ProjectMetricScore, 'overallScore'>): number {
  const trirComponent = score.trir === 0 ? 100 : Math.max(0, 100 - score.trir * 20);
  const daysComponent = Math.min(100, (score.daysSinceLastIncident / 365) * 100);

  // Codex P2 PR #103: si no hay closure rate, redistribuye el 15% del peso
  // entre los componentes restantes proporcionalmente. No premia ausencia.
  const closureRate = score.correctiveActionClosureRate;
  if (closureRate === null) {
    // Sin closure: pesos renormalizados a (30+20+15+10+10)=85 → divide por 0.85
    const overall =
      (0.30 * score.complianceTrafficLightScore +
        0.20 * score.trainingCoverage +
        0.15 * score.eppCoverage +
        0.10 * trirComponent +
        0.10 * daysComponent) /
      0.85;
    return Math.max(0, Math.min(100, Math.round(overall)));
  }

  const overall =
    0.30 * score.complianceTrafficLightScore +
    0.20 * score.trainingCoverage +
    0.15 * score.eppCoverage +
    0.15 * (closureRate * 100) +
    0.10 * trirComponent +
    0.10 * daysComponent;
  return Math.max(0, Math.min(100, Math.round(overall)));
}

function scoreProject(snap: ProjectSnapshot): ProjectMetricScore {
  const exposure: ExposureInput = { totalHoursWorked: snap.totalHoursWorked };
  const trir = calculateTrir(snap.incidents, exposure);
  const ltifr = calculateLtifr(snap.incidents, exposure);
  const totalActions = snap.openCorrectiveActions + snap.closedCorrectiveActions;
  // Codex P2 PR #103: si no hay acciones, NO asignar 100% de closure rate
  // (falsamente premia proyectos sin gestión de acciones).
  // Marcamos undefined → componente excluido del overallScore.
  const closureRate = totalActions > 0 ? snap.closedCorrectiveActions / totalActions : null;

  const partial: Omit<ProjectMetricScore, 'overallScore'> = {
    projectId: snap.projectId,
    projectName: snap.projectName,
    trir: Math.round(trir * 100) / 100,
    ltifr: Math.round(ltifr * 100) / 100,
    complianceTrafficLightScore: snap.complianceTrafficLightScore,
    trainingCoverage: snap.trainingCoverage,
    eppCoverage: snap.eppCoverage,
    correctiveActionClosureRate:
      closureRate === null ? null : Math.round(closureRate * 100) / 100,
    daysSinceLastIncident: snap.daysSinceLastIncident,
    // Codex P2 PR #103: preservar SIF/fatalities para risk flagging
    seriousInjuriesAndFatalities: snap.incidents.seriousInjuriesAndFatalities,
    fatalities: snap.incidents.fatalities,
  };
  return { ...partial, overallScore: computeOverallScore(partial) };
}

// ────────────────────────────────────────────────────────────────────────
// Public comparator
// ────────────────────────────────────────────────────────────────────────

export function compareProjects(snapshots: ProjectSnapshot[]): ComparisonReport {
  const scores = snapshots.map(scoreProject);

  if (scores.length === 0) {
    return {
      scores: [],
      topProject: null,
      worstProject: null,
      averages: {
        trir: 0,
        ltifr: 0,
        compliance: 0,
        trainingCoverage: 0,
        eppCoverage: 0,
        overallScore: 0,
        closureRate: 0,
      },
      trirOutliers: [],
    };
  }

  const sorted = [...scores].sort((a, b) => b.overallScore - a.overallScore);
  const topProject = sorted[0];
  const worstProject = sorted[sorted.length - 1];

  const n = scores.length;
  const avgTrir = scores.reduce((s, x) => s + x.trir, 0) / n;
  const avgLtifr = scores.reduce((s, x) => s + x.ltifr, 0) / n;
  const avgCompliance = scores.reduce((s, x) => s + x.complianceTrafficLightScore, 0) / n;
  const avgTraining = scores.reduce((s, x) => s + x.trainingCoverage, 0) / n;
  const avgEpp = scores.reduce((s, x) => s + x.eppCoverage, 0) / n;
  const avgOverall = scores.reduce((s, x) => s + x.overallScore, 0) / n;
  // Codex P2 PR #103: avg closure excluding null para comparación correcta.
  const closureRates = scores
    .map((s) => s.correctiveActionClosureRate)
    .filter((r): r is number => r !== null);
  const avgClosureRate =
    closureRates.length > 0
      ? closureRates.reduce((s, r) => s + r, 0) / closureRates.length
      : 0;

  // Codex P2 PR #103: leave-one-out — comparar cada proyecto vs el
  // promedio del RESTO. Con incluirse, dos proyectos jamás flag al peor:
  // (high > 2 * (high+low)/2) → 0 > low (imposible).
  const trirSum = scores.reduce((s, x) => s + x.trir, 0);
  const trirOutliers: string[] = [];
  for (const s of scores) {
    const otherN = scores.length - 1;
    if (otherN < 1) continue;
    const otherAvg = (trirSum - s.trir) / otherN;
    if (otherAvg > 0 && s.trir > otherAvg * 2) {
      trirOutliers.push(s.projectId);
    }
  }

  return {
    scores,
    topProject,
    worstProject,
    averages: {
      trir: Math.round(avgTrir * 100) / 100,
      ltifr: Math.round(avgLtifr * 100) / 100,
      compliance: Math.round(avgCompliance),
      trainingCoverage: Math.round(avgTraining),
      eppCoverage: Math.round(avgEpp),
      overallScore: Math.round(avgOverall),
      closureRate: Math.round(avgClosureRate * 100) / 100,
    },
    trirOutliers,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Best-practice extraction (qué hace el top project bien)
// ────────────────────────────────────────────────────────────────────────

export interface BestPractice {
  metric: string;
  topValue: number;
  averageValue: number;
  recommendation: string;
}

export function extractBestPractices(report: ComparisonReport): BestPractice[] {
  if (!report.topProject) return [];
  const t = report.topProject;
  const a = report.averages;
  const practices: BestPractice[] = [];

  if (t.complianceTrafficLightScore > a.compliance + 10) {
    practices.push({
      metric: 'compliance',
      topValue: t.complianceTrafficLightScore,
      averageValue: a.compliance,
      recommendation: `${t.projectName} mantiene ${t.complianceTrafficLightScore}% en semáforo. Analizar prácticas internas y replicar.`,
    });
  }
  if (t.trainingCoverage > a.trainingCoverage + 15) {
    practices.push({
      metric: 'training_coverage',
      topValue: t.trainingCoverage,
      averageValue: a.trainingCoverage,
      recommendation: `${t.projectName} tiene ${t.trainingCoverage}% cobertura de capacitaciones. Replicar calendario + recordatorios.`,
    });
  }
  if (t.eppCoverage > a.eppCoverage + 15) {
    practices.push({
      metric: 'epp_coverage',
      topValue: t.eppCoverage,
      averageValue: a.eppCoverage,
      recommendation: `${t.projectName} mantiene ${t.eppCoverage}% EPP vigente. Replicar proceso de renovación.`,
    });
  }
  // Codex P2 PR #103: comparar closure rate vs AVG closure rate, no vs overallScore.
  if (
    t.correctiveActionClosureRate !== null &&
    t.correctiveActionClosureRate >= 0.9 &&
    t.correctiveActionClosureRate > a.closureRate + 0.2
  ) {
    practices.push({
      metric: 'closure_rate',
      topValue: Math.round(t.correctiveActionClosureRate * 100),
      averageValue: Math.round(a.closureRate * 100),
      recommendation: `${t.projectName} cierra ${Math.round(t.correctiveActionClosureRate * 100)}% acciones (vs promedio ${Math.round(a.closureRate * 100)}%). Analizar liderazgo + asignación.`,
    });
  }

  return practices;
}

// ────────────────────────────────────────────────────────────────────────
// Risk projects (atención inmediata)
// ────────────────────────────────────────────────────────────────────────

export interface RiskProjectAlert {
  projectId: string;
  projectName: string;
  reasons: string[];
}

export function flagRiskProjects(report: ComparisonReport): RiskProjectAlert[] {
  const alerts: RiskProjectAlert[] = [];
  for (const s of report.scores) {
    const reasons: string[] = [];
    // Codex P2 PR #103: SIF/fatality automáticamente flag con prioridad
    // máxima (independiente de cualquier otro umbral).
    if (s.fatalities > 0) reasons.push(`Fatalidad(es) registrada(s): ${s.fatalities}`);
    if (s.seriousInjuriesAndFatalities > 0)
      reasons.push(`SIF events: ${s.seriousInjuriesAndFatalities}`);
    if (s.overallScore < 50) reasons.push(`Score global ${s.overallScore}/100`);
    if (s.complianceTrafficLightScore < 60) reasons.push(`Semáforo cumplimiento rojo (${s.complianceTrafficLightScore}/100)`);
    if (s.trainingCoverage < 50) reasons.push(`Cobertura training ${s.trainingCoverage}%`);
    if (s.eppCoverage < 50) reasons.push(`Cobertura EPP ${s.eppCoverage}%`);
    if (report.trirOutliers.includes(s.projectId)) reasons.push(`TRIR ${s.trir} (>2× promedio resto)`);
    if (s.daysSinceLastIncident < 7) reasons.push(`Incidente reciente (${s.daysSinceLastIncident}d)`);

    if (reasons.length > 0) {
      alerts.push({
        projectId: s.projectId,
        projectName: s.projectName,
        reasons,
      });
    }
  }
  // Ordenar por cantidad de razones desc
  return alerts.sort((a, b) => b.reasons.length - a.reasons.length);
}
