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
  /** Closure rate F.4 (closed / (open+closed)). */
  correctiveActionClosureRate: number;
  daysSinceLastIncident: number;
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

  const overall =
    0.30 * score.complianceTrafficLightScore +
    0.20 * score.trainingCoverage +
    0.15 * score.eppCoverage +
    0.15 * (score.correctiveActionClosureRate * 100) +
    0.10 * trirComponent +
    0.10 * daysComponent;
  return Math.max(0, Math.min(100, Math.round(overall)));
}

function scoreProject(snap: ProjectSnapshot): ProjectMetricScore {
  const exposure: ExposureInput = { totalHoursWorked: snap.totalHoursWorked };
  const trir = calculateTrir(snap.incidents, exposure);
  const ltifr = calculateLtifr(snap.incidents, exposure);
  const totalActions = snap.openCorrectiveActions + snap.closedCorrectiveActions;
  const closureRate = totalActions > 0 ? snap.closedCorrectiveActions / totalActions : 1;

  const partial: Omit<ProjectMetricScore, 'overallScore'> = {
    projectId: snap.projectId,
    projectName: snap.projectName,
    trir: Math.round(trir * 100) / 100,
    ltifr: Math.round(ltifr * 100) / 100,
    complianceTrafficLightScore: snap.complianceTrafficLightScore,
    trainingCoverage: snap.trainingCoverage,
    eppCoverage: snap.eppCoverage,
    correctiveActionClosureRate: Math.round(closureRate * 100) / 100,
    daysSinceLastIncident: snap.daysSinceLastIncident,
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

  const trirOutliers = scores
    .filter((s) => avgTrir > 0 && s.trir > avgTrir * 2)
    .map((s) => s.projectId);

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
  if (t.correctiveActionClosureRate >= 0.9 && t.correctiveActionClosureRate > a.overallScore / 100 + 0.2) {
    practices.push({
      metric: 'closure_rate',
      topValue: Math.round(t.correctiveActionClosureRate * 100),
      averageValue: Math.round((a.overallScore / 100) * 100),
      recommendation: `${t.projectName} cierra ${Math.round(t.correctiveActionClosureRate * 100)}% acciones. Analizar liderazgo + asignación.`,
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
    if (s.overallScore < 50) reasons.push(`Score global ${s.overallScore}/100`);
    if (s.complianceTrafficLightScore < 60) reasons.push(`Semáforo cumplimiento rojo (${s.complianceTrafficLightScore}/100)`);
    if (s.trainingCoverage < 50) reasons.push(`Cobertura training ${s.trainingCoverage}%`);
    if (s.eppCoverage < 50) reasons.push(`Cobertura EPP ${s.eppCoverage}%`);
    if (report.trirOutliers.includes(s.projectId)) reasons.push(`TRIR ${s.trir} (>2× promedio)`);
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
