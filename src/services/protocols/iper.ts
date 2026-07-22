/**
 * IPER — Identificación de Peligros y Evaluación de Riesgos.
 *
 * Reference: SUSESO Guía Técnica DS 44/2024 (Reglamento del Sistema de Gestión de
 * la Seguridad y Salud en el Trabajo) and ACHS / IST / Mutual Manual IPER.
 * The 5×5 risk matrix below (Probability × Severity) is the standard mapping
 * adopted by the Chilean mutuales for sectorial IPER assessments.
 *
 * The matrix is documented as {trivial, tolerable, moderado, importante,
 * intolerable} which corresponds to AS/NZS 4360 nomenclature in Spanish.
 *
 * Worked example: a worker performing manual lifting in a warehouse with
 * P=4 (probable, occurs once a week) and S=3 (lesión incapacitante temporal)
 * → score 12 → "moderado" → recomendación: implementar controles dentro de
 * 30 días.
 */

export type IperLevel =
  | 'trivial'
  | 'tolerable'
  | 'moderado'
  | 'importante'
  | 'intolerable';

export type IperColor =
  | '#22c55e'
  | '#eab308'
  | '#f59e0b'
  | '#f97316'
  | '#ef4444';

/**
 * DS 44/2024 — enfoque de género. The derogated DS 40 evaluated a single,
 * undifferentiated "worker"; DS 44 requires the evaluation to consider how the
 * SAME hazard lands differently depending on the exposed population. Every
 * field is optional so the base 5×5 contract is untouched when absent.
 */
export interface IperGenderLens {
  /** Exposure to this hazard is known to differ by sex for this task. */
  differentiatedBySex?: boolean;
  /** Pregnant or breastfeeding workers are exposed to this hazard. */
  maternityExposure?: boolean;
  /** No PPE available in the anthropometry/sizing the exposed population needs. */
  ppeAnthropometryGap?: boolean;
  /** Psychosocial hazard with sex-differentiated incidence (harassment). */
  genderedPsychosocial?: boolean;
}

/**
 * DS 44/2024 — gestión de desastres. Natural-hazard scenarios evaluated INSIDE
 * the matrix, not as a separate emergency module: Chile is highly seismic and
 * the norm folds disaster management into preventive risk management by design.
 */
export type DisasterHazard =
  | 'sismo'
  | 'tsunami'
  | 'inundacion'
  | 'incendio_forestal'
  | 'aluvion'
  | 'erupcion_volcanica'
  | 'viento_extremo';

const DISASTER_LABEL: Record<DisasterHazard, string> = {
  sismo: 'sismo',
  tsunami: 'tsunami',
  inundacion: 'inundación',
  incendio_forestal: 'incendio forestal',
  aluvion: 'aluvión',
  erupcion_volcanica: 'erupción volcánica',
  viento_extremo: 'viento extremo',
};

export interface IperInput {
  /** 1 = raro, 5 = casi cierto */
  probability: 1 | 2 | 3 | 4 | 5;
  /** 1 = insignificante, 5 = catastrófico */
  severity: 1 | 2 | 3 | 4 | 5;
  /** Optional residual modifier (effectiveness of existing controls). */
  controlEffectiveness?: 'none' | 'low' | 'medium' | 'high';
  /** DS 44 — enfoque de género (optional; absent ⇒ base matrix unchanged). */
  genderLens?: IperGenderLens;
  /** DS 44 — natural-hazard scenario being evaluated. */
  disasterHazard?: DisasterHazard;
  /** Whether a current emergency/evacuation plan covers `disasterHazard`. */
  emergencyPlanInPlace?: boolean;
}

export interface IperResult {
  rawScore: number;
  level: IperLevel;
  color: IperColor;
  residualLevel?: IperLevel;
  recommendation: string;
  /**
   * DS 44 recommendations raised by the gender lens / disaster dimension.
   *
   * These are RECOMMENDATIONS, never an automatic reclassification: the engine
   * states what the norm asks for and cites the legal basis so the
   * prevencionista can verify it and decide. `level` and `residualLevel` above
   * are never altered by this lens — the classification stays the user's.
   *
   * Undefined (not an empty array) when no DS 44 input was given, mirroring how
   * `residualLevel` is omitted — keeps existing payloads byte-identical.
   */
  ds44Recommendations?: Ds44Recommendation[];
}

/** A single DS 44 recommendation, with the norm it comes from. */
export interface Ds44Recommendation {
  /** What the norm asks for, in plain es-CL for the prevencionista. */
  text: string;
  /** The legal basis, so the user can verify it instead of trusting the app. */
  basis: string;
  /**
   * The level this factor would suggest for the exposed population. A
   * SUGGESTION shown next to the computed level — never applied automatically.
   */
  suggestedLevel?: IperLevel;
}

// ─────────────────────────────────────────────────────────────────────
// 5×5 Matrix — rows are probability (1..5), columns are severity (1..5).
// Values per the spec encoded combination-by-combination.
// ─────────────────────────────────────────────────────────────────────
export const IPER_MATRIX: readonly (readonly IperLevel[])[] = [
  // P=1
  ['trivial', 'trivial', 'tolerable', 'tolerable', 'moderado'],
  // P=2
  ['trivial', 'tolerable', 'tolerable', 'moderado', 'moderado'],
  // P=3
  ['tolerable', 'tolerable', 'moderado', 'moderado', 'importante'],
  // P=4
  ['tolerable', 'moderado', 'moderado', 'importante', 'importante'],
  // P=5
  ['moderado', 'moderado', 'importante', 'importante', 'intolerable'],
] as const;

const COLOR_BY_LEVEL: Record<IperLevel, IperColor> = {
  trivial: '#22c55e',
  tolerable: '#eab308',
  moderado: '#f59e0b',
  importante: '#f97316',
  intolerable: '#ef4444',
};

const LEVEL_ORDER: IperLevel[] = [
  'trivial',
  'tolerable',
  'moderado',
  'importante',
  'intolerable',
];

const RECOMMENDATION_BY_LEVEL: Record<IperLevel, string> = {
  trivial:
    'Riesgo trivial. No requiere acción específica; mantener vigilancia y registros.',
  tolerable:
    'Riesgo tolerable. No requiere controles adicionales; considerar mejoras de bajo costo y monitoreo periódico.',
  moderado:
    'Riesgo moderado. Implementar controles dentro de 30 días y reducir la exposición; revisar procedimientos.',
  importante:
    'Riesgo importante. Suspender la actividad hasta reducir el riesgo. Plazo máximo: días, con controles inmediatos.',
  intolerable:
    'Riesgo intolerable. Detener la actividad de inmediato. No reanudar hasta reducir el riesgo a un nivel aceptable.',
};

function reduceLevel(level: IperLevel, steps: number): IperLevel {
  const idx = LEVEL_ORDER.indexOf(level);
  const newIdx = Math.max(0, idx - steps);
  return LEVEL_ORDER[newIdx];
}

function assertInRange(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(
      `IPER: ${name} must be an integer in [1,5] (received ${value})`,
    );
  }
}

function escalateLevel(level: IperLevel, steps: number): IperLevel {
  const idx = LEVEL_ORDER.indexOf(level);
  const newIdx = Math.min(LEVEL_ORDER.length - 1, idx + steps);
  return LEVEL_ORDER[newIdx];
}

/**
 * DS 44/2024 evaluation layer. Pure: turns the differentiated-population and
 * disaster inputs into RECOMMENDATIONS, each citing the norm behind it.
 *
 * Deliberately non-coercive: this lens never reclassifies the risk and never
 * withdraws residual credit on its own. Guardian designs the management; the
 * prevencionista decides. Citing the legal basis is what gives the
 * recommendation its weight — the user can verify it instead of trusting us.
 *
 * It lives in the engine (not in a screen) for the reason documented in
 * `iperCriticidad.ts`: every consumer must derive the same answer.
 */
function evaluateDs44(input: IperInput, baseLevel: IperLevel): Ds44Recommendation[] {
  const recommendations: Ds44Recommendation[] = [];
  const lens = input.genderLens;

  if (lens?.maternityExposure) {
    recommendations.push({
      text:
        'La ley exige apartar a la trabajadora embarazada o en período de lactancia de toda labor perjudicial para su salud y reasignarla a otra sin riesgo, sin reducción de sus remuneraciones. Se recomienda evaluar la reasignación y dejarla registrada.',
      basis: 'Código del Trabajo art. 202 · DS 44/2024 (enfoque de género)',
      // Suggested, never applied: a hazard merely tolerable for the general
      // population may not be for a pregnant worker once the consequence is
      // incapacitating or worse (S≥3).
      suggestedLevel: input.severity >= 3 ? escalateLevel(baseLevel, 1) : undefined,
    });
  }

  if (lens?.ppeAnthropometryGap) {
    recommendations.push({
      text:
        'El EPP debe ser adecuado a la persona que lo usa: el dimensionado para el promedio masculino no protege a quien no calza en él. Se recomienda proveer EPP en la antropometría y tallaje de la población expuesta y considerar no acreditar reducción de riesgo residual mientras esa brecha exista.',
      basis: 'DS 44/2024 (enfoque de género) · DS 594 (EPP adecuado)',
    });
  }

  if (lens?.genderedPsychosocial) {
    recommendations.push({
      text:
        'Se recomienda evaluar este riesgo psicosocial con datos desagregados por sexo y mantener visible el canal de denuncia de acoso laboral y sexual, que la ley exige tener habilitado.',
      basis: 'Ley 21.643 (Ley Karin) · DS 44/2024 (enfoque de género)',
    });
  }

  if (lens?.differentiatedBySex) {
    recommendations.push({
      text:
        'Se recomienda registrar la exposición desagregada por sexo para poder demostrar si el peligro impacta de forma diferenciada, que es lo que la norma pide evaluar.',
      basis: 'DS 44/2024 (enfoque de género)',
    });
  }

  if (input.disasterHazard) {
    const label = DISASTER_LABEL[input.disasterHazard];
    if (input.emergencyPlanInPlace) {
      recommendations.push({
        text: `Amenaza de ${label}: se recomienda mantener vigente el plan de emergencia y evacuación — simulacros periódicos, zonas seguras señalizadas y roles de brigada asignados.`,
        basis: 'DS 44/2024 (gestión de desastres)',
      });
    } else {
      recommendations.push({
        text: `Amenaza de ${label}: no se registra un plan de emergencia y evacuación vigente. Se recomienda elaborarlo (zonas seguras, roles de brigada, simulacros periódicos) y reevaluar este riesgo con el plan en marcha.`,
        basis: 'DS 44/2024 (gestión de desastres)',
        suggestedLevel: escalateLevel(baseLevel, 1),
      });
    }
  }

  return recommendations;
}

export function calculateIper(input: IperInput): IperResult {
  assertInRange('probability', input.probability);
  assertInRange('severity', input.severity);

  const level = IPER_MATRIX[input.probability - 1][input.severity - 1];
  const rawScore = input.probability * input.severity;
  const color = COLOR_BY_LEVEL[level];

  let residualLevel: IperLevel | undefined;
  if (input.controlEffectiveness !== undefined) {
    const stepsByControl: Record<NonNullable<IperInput['controlEffectiveness']>, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
    };
    residualLevel = reduceLevel(level, stepsByControl[input.controlEffectiveness]);
  }

  const result: IperResult = {
    rawScore,
    level,
    color,
    residualLevel,
    recommendation: RECOMMENDATION_BY_LEVEL[level],
  };

  // The DS 44 lens only ADDS recommendations — it never touches `level`,
  // `residualLevel` or `recommendation` above. Kept undefined (not an empty
  // array) with no DS 44 input so the 19 downstream consumers and existing
  // persisted payloads stay byte-identical.
  const ds44 = evaluateDs44(input, level);
  if (ds44.length > 0) result.ds44Recommendations = ds44;

  return result;
}
