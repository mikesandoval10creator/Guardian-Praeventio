// Praeventio Guard — Sprint 55 Fase F.27: Project Comparator.
//
// Cierra Plan F.27 "Comparador de Proyectos". Función pura que dado N
// project snapshots computa KPIs side-by-side. 100% determinístico,
// sin LLM, sin Firestore (puro). El caller (UI / API) le pasa los
// datos ya agregados; el servicio normaliza y rankea.
//
// Diseño:
//   - El input son `ProjectSnapshot[]` (incidents/findings/audits/risks
//     ya contados por el caller — viene del grafo Zettelkasten o del
//     server side-effect que ya agrega esos KPIs hoy).
//   - El output es una `ComparisonReport` con métricas normalizadas
//     (0-100 = mejor), winners por KPI, y un overall score.
//   - Soporta hasta 4 proyectos a la vez (límite UI; la lógica
//     escala a N pero la table comparison gets noisy >4).
//
// NO bloquea ni recomienda decisiones — sólo asiste con datos para
// que el supervisor / gerencia decida con criterio. Directiva 2.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/** KPIs comparables por proyecto. Caller debe pre-agregar estos números. */
export interface ProjectSnapshot {
  projectId: string;
  /** Nombre legible. */
  projectName: string;
  /** ISO-8601 — momento del snapshot. */
  snapshotAt: string;
  /** Métricas brutas. Más alto NO siempre es mejor — ver `direction`. */
  metrics: {
    /** Incidentes registrados en ventana. Lower = better. */
    incidentCount: number;
    /** Hallazgos abiertos. Lower = better. */
    openFindingsCount: number;
    /** Auditorías cumplidas (%) 0-100. Higher = better. */
    auditCompliancePct: number;
    /** Riesgos críticos activos. Lower = better. */
    criticalRisksCount: number;
    /** Trabajadores expuestos. Contexto, no se rankea. */
    workersCount: number;
    /** Acciones correctivas cerradas a tiempo (%) 0-100. Higher = better. */
    correctiveActionsOnTimePct: number;
  };
}

export type ComparisonMetricKey =
  | 'incidentCount'
  | 'openFindingsCount'
  | 'auditCompliancePct'
  | 'criticalRisksCount'
  | 'correctiveActionsOnTimePct';

/** Dirección óptima de cada KPI. */
export type MetricDirection = 'lower_is_better' | 'higher_is_better';

export const METRIC_DIRECTIONS: Record<ComparisonMetricKey, MetricDirection> = {
  incidentCount: 'lower_is_better',
  openFindingsCount: 'lower_is_better',
  auditCompliancePct: 'higher_is_better',
  criticalRisksCount: 'lower_is_better',
  correctiveActionsOnTimePct: 'higher_is_better',
};

/** Label canónico ES para cada KPI (la UI usa i18n keys, pero el service
 *  expone esto para reports que se exportan sin i18n). */
export const METRIC_LABELS_ES: Record<ComparisonMetricKey, string> = {
  incidentCount: 'Incidentes',
  openFindingsCount: 'Hallazgos abiertos',
  auditCompliancePct: 'Cumplimiento auditorías',
  criticalRisksCount: 'Riesgos críticos',
  correctiveActionsOnTimePct: 'CA cerradas a tiempo',
};

export interface MetricComparison {
  metric: ComparisonMetricKey;
  direction: MetricDirection;
  /** Valor crudo por proyecto, en el mismo orden que `projectIds`. */
  values: number[];
  /** Mejor valor de la fila. */
  bestValue: number;
  /** Peor valor de la fila. */
  worstValue: number;
  /** projectId que gana esta métrica. `null` si todos empatan. */
  winnerProjectId: string | null;
  /** Score normalizado 0-100 por proyecto (100 = mejor relativo). */
  normalizedScores: number[];
}

export interface ProjectOverallScore {
  projectId: string;
  projectName: string;
  /** Score 0-100 (promedio de normalizedScores). */
  overallScore: number;
  /** Cuántos KPIs gana este proyecto. */
  kpiWins: number;
}

export interface ComparisonReport {
  /** Snapshots tal como vinieron (orden estable). */
  projects: ProjectSnapshot[];
  /** Una fila por KPI rankeable. */
  metricComparisons: MetricComparison[];
  /** Score agregado por proyecto, ordenado desc por overallScore. */
  overallRanking: ProjectOverallScore[];
  /** Generado en. */
  generatedAt: string;
  /** Notas legibles ES sobre el resultado (sin recomendar decisión). */
  observations: string[];
}

export class ProjectComparatorError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'ProjectComparatorError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

/** Máximo recomendado para la UI (table columns get noisy >4). El service
 *  lanza si excede para que el caller decida limpiar. */
export const MAX_PROJECTS_TO_COMPARE = 4;
/** Mínimo (no tiene sentido comparar 1 proyecto). */
export const MIN_PROJECTS_TO_COMPARE = 2;

const RANKED_METRICS: ComparisonMetricKey[] = [
  'incidentCount',
  'openFindingsCount',
  'auditCompliancePct',
  'criticalRisksCount',
  'correctiveActionsOnTimePct',
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Normaliza un valor a 0-100 dentro del rango [worst, best] respetando
 *  la dirección del KPI. Si todos los valores son iguales, devuelve 100
 *  (empate = todos perfectos relativos). */
function normalizeValue(
  value: number,
  values: ReadonlyArray<number>,
  direction: MetricDirection,
): number {
  if (values.length === 0) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return 100; // empate
  if (direction === 'higher_is_better') {
    return ((value - min) / (max - min)) * 100;
  }
  // lower_is_better
  return ((max - value) / (max - min)) * 100;
}

function pickWinner(
  values: ReadonlyArray<number>,
  projectIds: ReadonlyArray<string>,
  direction: MetricDirection,
): string | null {
  if (values.length === 0) return null;
  const target = direction === 'higher_is_better' ? Math.max(...values) : Math.min(...values);
  // Si TODOS son iguales => empate.
  if (values.every((v) => v === target)) return null;
  // Primer index con el valor objetivo (estable). En la práctica los
  // empates parciales (2 ganan, otros pierden) se resuelven al primero,
  // pero `kpiWins` después suma a TODOS los empatados arriba.
  const idx = values.indexOf(target);
  return projectIds[idx] ?? null;
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export function validateSnapshots(snapshots: ReadonlyArray<ProjectSnapshot>): void {
  if (snapshots.length < MIN_PROJECTS_TO_COMPARE) {
    throw new ProjectComparatorError(
      'NOT_ENOUGH_PROJECTS',
      `at least ${MIN_PROJECTS_TO_COMPARE} projects required (got ${snapshots.length})`,
    );
  }
  if (snapshots.length > MAX_PROJECTS_TO_COMPARE) {
    throw new ProjectComparatorError(
      'TOO_MANY_PROJECTS',
      `max ${MAX_PROJECTS_TO_COMPARE} projects supported (got ${snapshots.length})`,
    );
  }
  // IDs únicos.
  const ids = new Set<string>();
  for (const s of snapshots) {
    if (!s.projectId || s.projectId.length === 0) {
      throw new ProjectComparatorError('INVALID_ID', 'projectId required');
    }
    if (ids.has(s.projectId)) {
      throw new ProjectComparatorError(
        'DUPLICATE_PROJECT',
        `projectId ${s.projectId} appears twice`,
      );
    }
    ids.add(s.projectId);
    // Rango básico de %.
    if (s.metrics.auditCompliancePct < 0 || s.metrics.auditCompliancePct > 100) {
      throw new ProjectComparatorError(
        'INVALID_PCT',
        `auditCompliancePct out of [0,100] for ${s.projectId}`,
      );
    }
    if (
      s.metrics.correctiveActionsOnTimePct < 0 ||
      s.metrics.correctiveActionsOnTimePct > 100
    ) {
      throw new ProjectComparatorError(
        'INVALID_PCT',
        `correctiveActionsOnTimePct out of [0,100] for ${s.projectId}`,
      );
    }
    // Counts no-negativos.
    for (const k of ['incidentCount', 'openFindingsCount', 'criticalRisksCount', 'workersCount'] as const) {
      if (s.metrics[k] < 0) {
        throw new ProjectComparatorError(
          'NEGATIVE_COUNT',
          `${k} negative for ${s.projectId}`,
        );
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Core
// ────────────────────────────────────────────────────────────────────────

export interface CompareOptions {
  /** ISO-8601 para sello del reporte. Default Date.now(). */
  now?: Date;
}

export function compareProjects(
  snapshots: ReadonlyArray<ProjectSnapshot>,
  options: CompareOptions = {},
): ComparisonReport {
  validateSnapshots(snapshots);
  const projects = [...snapshots]; // copy para estabilidad
  const projectIds = projects.map((p) => p.projectId);

  const metricComparisons: MetricComparison[] = RANKED_METRICS.map((metric) => {
    const direction = METRIC_DIRECTIONS[metric];
    const values = projects.map((p) => p.metrics[metric]);
    const winnerProjectId = pickWinner(values, projectIds, direction);
    const normalizedScores = values.map((v) => normalizeValue(v, values, direction));
    const bestValue =
      direction === 'higher_is_better' ? Math.max(...values) : Math.min(...values);
    const worstValue =
      direction === 'higher_is_better' ? Math.min(...values) : Math.max(...values);
    return {
      metric,
      direction,
      values,
      bestValue,
      worstValue,
      winnerProjectId,
      normalizedScores,
    };
  });

  // Overall score = promedio de normalizedScores por proyecto.
  // kpiWins = cuántas métricas tiene cada uno con normalizedScore=100.
  const overallRanking: ProjectOverallScore[] = projects.map((p, projectIdx) => {
    let sum = 0;
    let wins = 0;
    for (const mc of metricComparisons) {
      const s = mc.normalizedScores[projectIdx] ?? 0;
      sum += s;
      if (s === 100) wins += 1;
    }
    const overallScore = metricComparisons.length === 0 ? 0 : sum / metricComparisons.length;
    return {
      projectId: p.projectId,
      projectName: p.projectName,
      overallScore: Math.round(overallScore * 10) / 10, // 1 decimal
      kpiWins: wins,
    };
  });

  overallRanking.sort((a, b) => {
    if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
    if (b.kpiWins !== a.kpiWins) return b.kpiWins - a.kpiWins;
    return a.projectName.localeCompare(b.projectName);
  });

  // Observaciones legibles (ES, no recomienda decisión — sólo describe).
  const observations: string[] = [];
  const top = overallRanking[0];
  const bottom = overallRanking[overallRanking.length - 1];
  if (top && bottom && top.overallScore - bottom.overallScore >= 20) {
    observations.push(
      `Diferencia significativa entre ${top.projectName} (score ${top.overallScore}) y ${bottom.projectName} (score ${bottom.overallScore}).`,
    );
  }
  if (top && top.kpiWins === metricComparisons.length) {
    observations.push(
      `${top.projectName} lidera en todos los KPIs comparados.`,
    );
  }
  if (observations.length === 0) {
    observations.push(
      'KPIs cercanos entre los proyectos comparados — diferencias menores a 20 puntos.',
    );
  }

  return {
    projects,
    metricComparisons,
    overallRanking,
    generatedAt: (options.now ?? new Date()).toISOString(),
    observations,
  };
}
