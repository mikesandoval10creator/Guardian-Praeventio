// Praeventio Guard — Sprint 41 F.26: Indicador de Madurez Preventiva.
//
// Modelo basado en la Bradley Curve (DuPont) y modelos de madurez SST:
//
//   Level 1 'reactivo'      — solo reacciona a accidentes ocurridos
//   Level 2 'cumplimiento'  — cumple la ley mínima por obligación
//   Level 3 'proactivo'     — mide leading indicators y mejora continuamente
//   Level 4 'sistémico'     — SST integrada al negocio y a la toma de decisión
//   Level 5 'autónomo'      — cultura interdependiente, autogestión preventiva
//
// El servicio es 100% determinístico (sin LLM). Pondera señales objetivas
// (cobertura de capacitación, IPER completados, CPHS, leading indicators,
// análisis causa raíz, BBS, compromiso ejecutivo…) y produce un reporte con:
//   - level (1-5)
//   - sub-puntajes por categoría (0..1)
//   - weakestArea (la categoría más débil → palanca para subir nivel)
//   - nextLevelGap (qué falta cuantitativamente para subir 1 nivel)
//   - 3 recomendaciones concretas (recommendNextSteps)

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type MaturityLevelNumber = 1 | 2 | 3 | 4 | 5;

export type MaturityLevelName =
  | 'reactivo'
  | 'cumplimiento'
  | 'proactivo'
  | 'sistémico'
  | 'autónomo';

export const LEVEL_NAMES: Record<MaturityLevelNumber, MaturityLevelName> = {
  1: 'reactivo',
  2: 'cumplimiento',
  3: 'proactivo',
  4: 'sistémico',
  5: 'autónomo',
};

/**
 * Señales objetivas que alimentan el índice. Todas son números 0..1 o conteos
 * normalizados. El servicio no opina sobre cómo se recolectaron — sólo evalúa.
 */
export interface MaturitySignals {
  /** Cobertura de capacitación vigente (0..1). */
  trainingCoverage: number;
  /** IPER/IPERS completados sobre los esperados (0..1). */
  ipersCompleted: number;
  /** Reuniones CPHS realizadas / esperadas por mes (0..1). */
  cphsMeetingFrequency: number;
  /** Cantidad de leading indicators efectivamente usados (0..10+). */
  leadingIndicatorsUsed: string[];
  /** Tasa de análisis causa raíz aplicada a incidentes (0..1). */
  rootCauseAnalysisRate: number;
  /** Programa de seguridad basada en comportamiento activo (0..1). */
  behaviorBasedSafety: number;
  /** Compromiso ejecutivo medido por presencia en walks/reviews (0..1). */
  executiveEngagement: number;
  /** Trabajadores reportan condiciones inseguras sin temor (0..1). */
  workerEmpowerment: number;
  /** SST integrada al planeamiento de proyectos/operaciones (0..1). */
  integrationWithOperations: number;
  /** Mejora continua documentada (lecciones aprendidas cerradas / abiertas). */
  continuousImprovement: number;
}

export type MaturityCategory =
  | 'foundation'      // base normativa: training + IPER + CPHS
  | 'measurement'     // medición: leading indicators + RCA
  | 'behavior'        // comportamiento: BBS + empowerment
  | 'leadership'      // liderazgo: executive engagement
  | 'integration';    // integración: ops + mejora continua

export interface MaturityReport {
  level: MaturityLevelNumber;
  levelName: MaturityLevelName;
  /** Score global ponderado, 0..1. */
  overallScore: number;
  /** Sub-puntajes por categoría, 0..1. */
  categoryScores: Record<MaturityCategory, number>;
  /** Categoría con menor puntaje (palanca para subir). */
  weakestArea: MaturityCategory;
  /**
   * Distancia al próximo nivel:
   * - `targetLevel`: nivel objetivo (level + 1, o null si ya está en 5).
   * - `pointsNeeded`: diferencia de score global para alcanzar el threshold.
   * - `weakestCategory`: la categoría que más arrastra hacia abajo.
   */
  nextLevelGap: {
    targetLevel: MaturityLevelNumber | null;
    pointsNeeded: number;
    weakestCategory: MaturityCategory;
  };
}

export interface MaturityRecommendation {
  category: MaturityCategory;
  /** Acción concreta, accionable en <= 1 sprint operativo. */
  action: string;
  /** Métrica objetivo que mejora si se ejecuta. */
  targetMetric: keyof MaturitySignals;
  /** Impacto esperado en el score global (0..1, estimado). */
  expectedImpact: number;
}

// ────────────────────────────────────────────────────────────────────────
// Internal config — pesos y thresholds
// ────────────────────────────────────────────────────────────────────────

/** Peso de cada categoría en el score global (suman 1.0). */
const CATEGORY_WEIGHT: Record<MaturityCategory, number> = {
  foundation: 0.25,
  measurement: 0.2,
  behavior: 0.2,
  leadership: 0.15,
  integration: 0.2,
};

/**
 * Threshold mínimo (overallScore) para alcanzar cada nivel.
 * Level 1 es el suelo: cualquier score por debajo del threshold de level 2.
 */
const LEVEL_THRESHOLDS: Record<Exclude<MaturityLevelNumber, 1>, number> = {
  2: 0.2,
  3: 0.45,
  4: 0.7,
  5: 0.88,
};

/** Cantidad de leading indicators que se considera "máximo" para normalizar. */
const LEADING_INDICATORS_TARGET = 6;

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += clamp01(v);
  return sum / values.length;
}

// ────────────────────────────────────────────────────────────────────────
// Category scoring
// ────────────────────────────────────────────────────────────────────────

function scoreFoundation(s: MaturitySignals): number {
  return avg([s.trainingCoverage, s.ipersCompleted, s.cphsMeetingFrequency]);
}

function scoreMeasurement(s: MaturitySignals): number {
  const leadingNorm = clamp01(
    s.leadingIndicatorsUsed.length / LEADING_INDICATORS_TARGET,
  );
  return avg([leadingNorm, s.rootCauseAnalysisRate]);
}

function scoreBehavior(s: MaturitySignals): number {
  return avg([s.behaviorBasedSafety, s.workerEmpowerment]);
}

function scoreLeadership(s: MaturitySignals): number {
  return clamp01(s.executiveEngagement);
}

function scoreIntegration(s: MaturitySignals): number {
  return avg([s.integrationWithOperations, s.continuousImprovement]);
}

function computeCategoryScores(
  s: MaturitySignals,
): Record<MaturityCategory, number> {
  return {
    foundation: scoreFoundation(s),
    measurement: scoreMeasurement(s),
    behavior: scoreBehavior(s),
    leadership: scoreLeadership(s),
    integration: scoreIntegration(s),
  };
}

function overallFromCategories(
  scores: Record<MaturityCategory, number>,
): number {
  let total = 0;
  for (const key of Object.keys(scores) as MaturityCategory[]) {
    total += scores[key] * CATEGORY_WEIGHT[key];
  }
  return clamp01(total);
}

function levelFromOverall(score: number): MaturityLevelNumber {
  if (score >= LEVEL_THRESHOLDS[5]) return 5;
  if (score >= LEVEL_THRESHOLDS[4]) return 4;
  if (score >= LEVEL_THRESHOLDS[3]) return 3;
  if (score >= LEVEL_THRESHOLDS[2]) return 2;
  return 1;
}

function pickWeakestArea(
  scores: Record<MaturityCategory, number>,
): MaturityCategory {
  let weakest: MaturityCategory = 'foundation';
  let weakestScore = Number.POSITIVE_INFINITY;
  // Iterate in fixed order for determinism on ties.
  const order: MaturityCategory[] = [
    'foundation',
    'measurement',
    'behavior',
    'leadership',
    'integration',
  ];
  for (const key of order) {
    if (scores[key] < weakestScore) {
      weakestScore = scores[key];
      weakest = key;
    }
  }
  return weakest;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

export function computeMaturityLevel(signals: MaturitySignals): MaturityReport {
  const categoryScores = computeCategoryScores(signals);
  const overallScore = overallFromCategories(categoryScores);
  const level = levelFromOverall(overallScore);
  const weakestArea = pickWeakestArea(categoryScores);

  const targetLevel: MaturityLevelNumber | null =
    level === 5 ? null : ((level + 1) as MaturityLevelNumber);
  const pointsNeeded =
    targetLevel === null
      ? 0
      : Math.max(0, LEVEL_THRESHOLDS[targetLevel] - overallScore);

  return {
    level,
    levelName: LEVEL_NAMES[level],
    overallScore,
    categoryScores,
    weakestArea,
    nextLevelGap: {
      targetLevel,
      pointsNeeded,
      weakestCategory: weakestArea,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Recommendations
// ────────────────────────────────────────────────────────────────────────

/**
 * Catálogo de acciones por categoría. Cada acción referencia la señal que
 * mejora si se ejecuta. Determinístico, sin LLM.
 */
const ACTION_CATALOG: Record<MaturityCategory, MaturityRecommendation[]> = {
  foundation: [
    {
      category: 'foundation',
      action:
        'Cerrar brechas de capacitación vigente: programar OPS de inducción y refrescos para todos los trabajadores activos.',
      targetMetric: 'trainingCoverage',
      expectedImpact: 0.08,
    },
    {
      category: 'foundation',
      action:
        'Completar IPER pendientes en todas las tareas críticas activas en obra.',
      targetMetric: 'ipersCompleted',
      expectedImpact: 0.07,
    },
    {
      category: 'foundation',
      action:
        'Asegurar la reunión mensual del Comité Paritario (CPHS) con acta firmada por todas las partes.',
      targetMetric: 'cphsMeetingFrequency',
      expectedImpact: 0.05,
    },
  ],
  measurement: [
    {
      category: 'measurement',
      action:
        'Definir y reportar al menos 6 leading indicators (observaciones, near-miss, walks gerenciales, etc.).',
      targetMetric: 'leadingIndicatorsUsed',
      expectedImpact: 0.07,
    },
    {
      category: 'measurement',
      action:
        'Aplicar análisis causa raíz (5-Why o Ishikawa) al 100% de los incidentes registrados.',
      targetMetric: 'rootCauseAnalysisRate',
      expectedImpact: 0.06,
    },
  ],
  behavior: [
    {
      category: 'behavior',
      action:
        'Implementar un programa de Seguridad Basada en Comportamiento (BBS) con observadores entrenados.',
      targetMetric: 'behaviorBasedSafety',
      expectedImpact: 0.08,
    },
    {
      category: 'behavior',
      action:
        'Habilitar canal anónimo y de bajo umbral para que trabajadores reporten condiciones inseguras sin temor.',
      targetMetric: 'workerEmpowerment',
      expectedImpact: 0.06,
    },
  ],
  leadership: [
    {
      category: 'leadership',
      action:
        'Comprometer a la gerencia a participar de al menos 1 safety walk semanal documentado.',
      targetMetric: 'executiveEngagement',
      expectedImpact: 0.07,
    },
  ],
  integration: [
    {
      category: 'integration',
      action:
        'Integrar SST a la planificación de operaciones: que cada proyecto inicie con plan preventivo aprobado.',
      targetMetric: 'integrationWithOperations',
      expectedImpact: 0.07,
    },
    {
      category: 'integration',
      action:
        'Cerrar las lecciones aprendidas abiertas: revisar pendientes y documentar acciones implementadas.',
      targetMetric: 'continuousImprovement',
      expectedImpact: 0.06,
    },
  ],
};

/**
 * Devuelve exactamente 3 acciones concretas para subir 1 nivel.
 * Estrategia: prioriza la categoría más débil, completa con la 2ª y 3ª más
 * débiles si la primera no tiene 3 acciones disponibles. Determinístico.
 */
export function recommendNextSteps(
  report: MaturityReport,
): MaturityRecommendation[] {
  // Ranking de categorías de menor a mayor score.
  const ranked = (Object.keys(report.categoryScores) as MaturityCategory[])
    .slice()
    .sort(
      (a, b) => report.categoryScores[a] - report.categoryScores[b],
    );

  const out: MaturityRecommendation[] = [];
  // Round-robin: tomar la primera acción de cada categoría débil hasta 3.
  const indexPerCategory: Record<MaturityCategory, number> = {
    foundation: 0,
    measurement: 0,
    behavior: 0,
    leadership: 0,
    integration: 0,
  };

  while (out.length < 3) {
    let added = false;
    for (const cat of ranked) {
      if (out.length >= 3) break;
      const idx = indexPerCategory[cat];
      const actions = ACTION_CATALOG[cat];
      if (idx < actions.length) {
        out.push(actions[idx]);
        indexPerCategory[cat] = idx + 1;
        added = true;
      }
    }
    if (!added) break; // safety: no more actions available
  }

  return out.slice(0, 3);
}
