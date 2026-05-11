// Praeventio Guard — Sprint 39 Fase I.3: Clasificación de Causa Raíz.
//
// Cierra: Documento usuario "Recomendaciones nuevas §28"
//
// Para cada incidente / desviación, clasificamos las causas raíz
// según una taxonomía estándar (ILO + ANSI Z10 + adaptación chilena).
// Permite análisis estadístico serio: "el 40% de nuestros incidentes
// tienen causa raíz en falta de procedimiento".

export type CauseFactor =
  /** Condición física insegura del entorno. */
  | 'condicion_subestandar'
  /** Acción del trabajador no conforme a estándar. */
  | 'acto_subestandar'
  /** Supervisor no detectó o no corrigió. */
  | 'falla_supervision'
  /** Procedimiento ausente o ambiguo. */
  | 'falla_procedimiento'
  /** Equipo en mal estado o no mantenido. */
  | 'falla_mantenimiento'
  /** Clima, terreno, externo. */
  | 'factor_ambiental'
  /** Cultura, presión por producción, comunicación. */
  | 'factor_organizacional'
  /** Capacitación deficiente o no realizada. */
  | 'falla_capacitacion'
  /** EPP no entregado / no usado. */
  | 'falla_epp'
  /** Diseño deficiente del sistema/área. */
  | 'falla_diseno';

export interface RootCauseAnalysis {
  incidentId: string;
  /** Factores presentes (1 incidente puede tener varios). */
  factors: CauseFactor[];
  /** Factor PRINCIPAL (one of factors). */
  primaryFactor: CauseFactor;
  /** Cadena de los 5 porqués (max 5 niveles). */
  fiveWhys: string[];
  analyzedByUid: string;
  analyzedAt: string;
  /** Acciones correctivas sugeridas. */
  suggestedActions: string[];
}

export interface CauseStats {
  /** Total análisis revisados. */
  totalAnalyses: number;
  /** Conteo por factor (un incidente puede sumar varios). */
  countByFactor: Record<CauseFactor, number>;
  /** Top 3 factores principales (más frecuentes como primary). */
  topPrimaryFactors: Array<{ factor: CauseFactor; count: number; percentOfTotal: number }>;
}

export class RootCauseValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'RootCauseValidationError';
  }
}

export interface BuildAnalysisInput {
  incidentId: string;
  factors: CauseFactor[];
  primaryFactor: CauseFactor;
  fiveWhys: string[];
  analyzedByUid: string;
  suggestedActions: string[];
  now?: Date;
}

export function buildAnalysis(input: BuildAnalysisInput): RootCauseAnalysis {
  if (input.factors.length === 0) {
    throw new RootCauseValidationError(
      'NO_FACTORS',
      'must include at least one factor',
    );
  }
  if (!input.factors.includes(input.primaryFactor)) {
    throw new RootCauseValidationError(
      'PRIMARY_NOT_IN_FACTORS',
      `primaryFactor '${input.primaryFactor}' must be in factors[]`,
    );
  }
  if (input.fiveWhys.length === 0 || input.fiveWhys.length > 5) {
    throw new RootCauseValidationError(
      'FIVE_WHYS_OUT_OF_RANGE',
      'fiveWhys must have between 1 and 5 entries',
    );
  }
  // Cada "porqué" debe tener contenido (≥15 chars).
  for (const w of input.fiveWhys) {
    if (w.trim().length < 15) {
      throw new RootCauseValidationError(
        'WHY_TOO_SHORT',
        `each fiveWhys entry must be ≥15 chars: got "${w.slice(0, 30)}..."`,
      );
    }
  }
  if (input.suggestedActions.length === 0) {
    throw new RootCauseValidationError(
      'NO_ACTIONS',
      'analysis must include at least one suggested action',
    );
  }

  const now = input.now ?? new Date();
  return {
    incidentId: input.incidentId,
    factors: [...new Set(input.factors)],
    primaryFactor: input.primaryFactor,
    fiveWhys: input.fiveWhys.map((w) => w.trim()),
    analyzedByUid: input.analyzedByUid,
    analyzedAt: now.toISOString(),
    suggestedActions: input.suggestedActions.map((a) => a.trim()),
  };
}

export function computeStats(analyses: RootCauseAnalysis[]): CauseStats {
  const countByFactor: Record<CauseFactor, number> = {
    condicion_subestandar: 0,
    acto_subestandar: 0,
    falla_supervision: 0,
    falla_procedimiento: 0,
    falla_mantenimiento: 0,
    factor_ambiental: 0,
    factor_organizacional: 0,
    falla_capacitacion: 0,
    falla_epp: 0,
    falla_diseno: 0,
  };
  const primaryCounts: Record<string, number> = {};
  for (const a of analyses) {
    for (const f of a.factors) {
      countByFactor[f] += 1;
    }
    primaryCounts[a.primaryFactor] = (primaryCounts[a.primaryFactor] ?? 0) + 1;
  }
  const total = analyses.length;
  const topPrimaryFactors = (Object.keys(primaryCounts) as CauseFactor[])
    .map((f) => ({
      factor: f,
      count: primaryCounts[f],
      percentOfTotal: total === 0 ? 0 : Math.round((primaryCounts[f] / total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return {
    totalAnalyses: total,
    countByFactor,
    topPrimaryFactors,
  };
}
