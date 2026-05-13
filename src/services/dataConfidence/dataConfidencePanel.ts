// Praeventio Guard — Sprint 43 §104: Panel Confianza Datos.
//
// Cierra §104 de la 2da tanda usuario "Recomendaciones nuevas":
// "Panel que muestra cuánto se puede confiar en los datos que está
// usando el sistema para sugerir/decidir. Ayuda al prevencionista a
// no creer ciegamente en IA si los datos son malos."
//
// 100% determinístico, sin IO. Toma snapshots de inventarios + feeds
// + lecturas y produce un score 0..100 por dimensión + recomendaciones.
//
// Dimensiones de confianza:
//   1. Cobertura — ¿todas las entidades requeridas existen?
//   2. Frescura — ¿qué tan vieja es la última actualización?
//   3. Completitud — ¿los registros tienen sus campos críticos?
//   4. Trazabilidad — ¿hay audit_log + autor por dato?
//   5. Concordancia — ¿hay contradicciones detectables?
//
// El score agregado = promedio ponderado de las 5 dimensiones.
// Bandera roja si cualquier dimensión <50.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'critical';

export interface ConfidenceDimension {
  name: 'coverage' | 'freshness' | 'completeness' | 'traceability' | 'concordance';
  score: number; // 0..100
  level: ConfidenceLevel;
  /** Detalle humano para mostrar en UI. */
  detail: string;
  /** Peso en el score agregado (suma = 1). */
  weight: number;
}

export interface DataConfidenceReport {
  generatedAt: string;
  overallScore: number; // 0..100
  overallLevel: ConfidenceLevel;
  dimensions: ConfidenceDimension[];
  /** Banderas rojas (dimensiones <50). */
  redFlags: string[];
  /** Sugerencias priorizadas para subir el score. */
  recommendations: string[];
}

/**
 * Inputs que el caller resuelve consultando sus collections.
 */
export interface ConfidenceInputs {
  /** Cuántas entidades de cada tipo existen (vs lo esperado). */
  coverage: {
    workersExpected: number;
    workersPresent: number;
    eppItemsExpected: number;
    eppItemsPresent: number;
    documentsRequired: number;
    documentsPresent: number;
  };
  /** Frescura — días desde última actualización para feeds clave. */
  freshness: {
    workersLastUpdateDays: number;
    eppInventoryLastUpdateDays: number;
    incidentsLastWriteDays: number;
    documentsLastReviewDays: number;
  };
  /** Completitud — ratio de registros con todos los campos críticos. */
  completeness: {
    workersWithFullProfileRatio: number; // 0..1
    eppWithExpirationRatio: number;
    incidentsWithRootCauseRatio: number;
    documentsWithApproverRatio: number;
  };
  /** Trazabilidad — ratio de entidades con audit_log. */
  traceability: {
    workersWithAuditLogRatio: number;
    eppWithAuditLogRatio: number;
    incidentsWithAuditLogRatio: number;
    documentsWithAuditLogRatio: number;
  };
  /** Concordancia — # de contradicciones detectadas (más es peor). */
  concordance: {
    inconsistenciesCount: number;
    /** Tamaño del dataset para normalizar (incidentes + docs + workers). */
    totalEntitiesScanned: number;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Dimension scoring
// ────────────────────────────────────────────────────────────────────────

function levelFor(score: number): ConfidenceLevel {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'low';
  return 'critical';
}

function ratioToScore(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function scoreCoverage(c: ConfidenceInputs['coverage']): { score: number; detail: string } {
  const ratios = [
    c.workersExpected > 0 ? c.workersPresent / c.workersExpected : 1,
    c.eppItemsExpected > 0 ? c.eppItemsPresent / c.eppItemsExpected : 1,
    c.documentsRequired > 0 ? c.documentsPresent / c.documentsRequired : 1,
  ].map((r) => Math.min(r, 1));
  const avg = ratios.reduce((s, x) => s + x, 0) / ratios.length;
  const score = ratioToScore(avg);
  const worst = Math.min(...ratios);
  let detail = `Cobertura ${score}% (workers, EPP, docs).`;
  if (worst < 0.5) {
    detail += ' Falta más de la mitad de alguna categoría.';
  } else if (worst < 0.8) {
    detail += ' Hay categorías con cobertura parcial.';
  }
  return { score, detail };
}

function scoreFreshness(f: ConfidenceInputs['freshness']): { score: number; detail: string } {
  // 0 días → 100; 30 días → 50; 60+ días → 0
  const decay = (days: number): number => Math.max(0, Math.min(100, 100 - (days * 100) / 60));
  const subs = [
    decay(f.workersLastUpdateDays),
    decay(f.eppInventoryLastUpdateDays),
    decay(f.incidentsLastWriteDays),
    decay(f.documentsLastReviewDays),
  ];
  const score = Math.round(subs.reduce((s, x) => s + x, 0) / subs.length);
  const oldest = Math.max(
    f.workersLastUpdateDays,
    f.eppInventoryLastUpdateDays,
    f.incidentsLastWriteDays,
    f.documentsLastReviewDays,
  );
  let detail = `Datos más viejos: ${oldest} días.`;
  if (oldest > 60) detail += ' Hay feeds estancados >2 meses.';
  return { score, detail };
}

function scoreCompleteness(c: ConfidenceInputs['completeness']): {
  score: number;
  detail: string;
} {
  const ratios = [
    c.workersWithFullProfileRatio,
    c.eppWithExpirationRatio,
    c.incidentsWithRootCauseRatio,
    c.documentsWithApproverRatio,
  ];
  const avg = ratios.reduce((s, x) => s + x, 0) / ratios.length;
  const score = ratioToScore(avg);
  const worst = Math.min(...ratios);
  let detail = `Completitud ${score}% (perfiles, EPP, RCA, aprobadores).`;
  if (worst < 0.5) detail += ' Algún feed clave bajo 50% de completitud.';
  return { score, detail };
}

function scoreTraceability(t: ConfidenceInputs['traceability']): {
  score: number;
  detail: string;
} {
  const ratios = [
    t.workersWithAuditLogRatio,
    t.eppWithAuditLogRatio,
    t.incidentsWithAuditLogRatio,
    t.documentsWithAuditLogRatio,
  ];
  const avg = ratios.reduce((s, x) => s + x, 0) / ratios.length;
  return {
    score: ratioToScore(avg),
    detail: `Trazabilidad audit_log promedio ${ratioToScore(avg)}%.`,
  };
}

function scoreConcordance(c: ConfidenceInputs['concordance']): {
  score: number;
  detail: string;
} {
  if (c.totalEntitiesScanned <= 0) {
    return { score: 100, detail: 'Sin entidades escaneadas (asumir 100).' };
  }
  // ratio de inconsistencias en el dataset
  const ratio = c.inconsistenciesCount / c.totalEntitiesScanned;
  // 0% inconsistencias → 100, 5% → 50, 10%+ → 0
  const score = Math.max(0, Math.min(100, Math.round(100 - ratio * 1000)));
  return {
    score,
    detail: `Inconsistencias ${c.inconsistenciesCount}/${c.totalEntitiesScanned} (${(ratio * 100).toFixed(1)}%).`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Aggregate
// ────────────────────────────────────────────────────────────────────────

const DIMENSION_WEIGHTS: Record<ConfidenceDimension['name'], number> = {
  coverage: 0.25,
  freshness: 0.2,
  completeness: 0.25,
  traceability: 0.15,
  concordance: 0.15,
};

export interface BuildOptions {
  now?: Date;
}

export function buildDataConfidenceReport(
  inputs: ConfidenceInputs,
  options: BuildOptions = {},
): DataConfidenceReport {
  const now = options.now ?? new Date();

  const cov = scoreCoverage(inputs.coverage);
  const fre = scoreFreshness(inputs.freshness);
  const com = scoreCompleteness(inputs.completeness);
  const tra = scoreTraceability(inputs.traceability);
  const con = scoreConcordance(inputs.concordance);

  const dimensions: ConfidenceDimension[] = [
    { name: 'coverage', score: cov.score, level: levelFor(cov.score), detail: cov.detail, weight: DIMENSION_WEIGHTS.coverage },
    { name: 'freshness', score: fre.score, level: levelFor(fre.score), detail: fre.detail, weight: DIMENSION_WEIGHTS.freshness },
    { name: 'completeness', score: com.score, level: levelFor(com.score), detail: com.detail, weight: DIMENSION_WEIGHTS.completeness },
    { name: 'traceability', score: tra.score, level: levelFor(tra.score), detail: tra.detail, weight: DIMENSION_WEIGHTS.traceability },
    { name: 'concordance', score: con.score, level: levelFor(con.score), detail: con.detail, weight: DIMENSION_WEIGHTS.concordance },
  ];

  const overallScore = Math.round(
    dimensions.reduce((s, d) => s + d.score * d.weight, 0),
  );

  const redFlags = dimensions
    .filter((d) => d.score < 50)
    .map((d) => `${d.name}: ${d.detail}`);

  const recommendations: string[] = [];
  if (cov.score < 80) {
    recommendations.push(
      'Completar inventario de trabajadores / EPP / documentos antes de confiar en sugerencias IA.',
    );
  }
  if (fre.score < 60) {
    recommendations.push(
      'Actualizar feeds estancados — solicitar refresh manual + agendar revisión periódica.',
    );
  }
  if (com.score < 70) {
    recommendations.push(
      'Cerrar perfiles incompletos: fechas de vencimiento EPP, causa raíz incidentes, aprobador docs.',
    );
  }
  if (tra.score < 60) {
    recommendations.push(
      'Activar audit_log en flujos donde aún no está (entidades sin historial son no-defendibles).',
    );
  }
  if (con.score < 70) {
    recommendations.push(
      'Resolver inconsistencias detectadas (corrida del consistency auditor) antes de auditoría externa.',
    );
  }

  return {
    generatedAt: now.toISOString(),
    overallScore,
    overallLevel: levelFor(overallScore),
    dimensions,
    redFlags,
    recommendations: recommendations.slice(0, 5),
  };
}
