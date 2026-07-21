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
   * DS 44 duties triggered by the gender lens / disaster dimension. Undefined
   * (not an empty array) when no DS 44 input was given, mirroring how
   * `residualLevel` is omitted — keeps existing payloads byte-identical.
   */
  ds44Obligations?: string[];
  /** True when a DS 44 factor escalated the base 5×5 level. */
  differentialEscalation?: boolean;
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
 * DS 44/2024 evaluation layer. Pure: derives the duties, the escalation and the
 * residual cap from the differentiated-population and disaster inputs.
 *
 * The escalation rules are deliberately conservative and explicit here (rather
 * than buried in a screen) because they carry legal weight — see the doctrine
 * in `iperCriticidad.ts`: the classification lives in this engine so every
 * screen derives the same answer.
 */
function evaluateDs44(input: IperInput): {
  obligations: string[];
  escalate: number;
  maxResidualSteps?: number;
} {
  const obligations: string[] = [];
  let escalate = 0;
  let maxResidualSteps: number | undefined;
  const lens = input.genderLens;

  if (lens?.maternityExposure) {
    obligations.push(
      'Protección a la maternidad: apartar a la trabajadora embarazada o en período de lactancia de esta tarea y reasignarla a una labor sin riesgo, sin reducción de sus remuneraciones (Código del Trabajo art. 202).',
    );
    // A hazard merely tolerable for the general population is not tolerable for
    // a pregnant worker once the consequence is incapacitating or worse (S≥3).
    if (input.severity >= 3) escalate += 1;
  }

  if (lens?.ppeAnthropometryGap) {
    obligations.push(
      'Proveer EPP en la antropometría y tallaje de la población expuesta: el EPP dimensionado para el promedio masculino no protege, por lo que no puede acreditarse como control eficaz.',
    );
    // PPE that does not fit cannot be claimed as a high-effectiveness control.
    maxResidualSteps = 1;
  }

  if (lens?.genderedPsychosocial) {
    obligations.push(
      'Evaluar el riesgo psicosocial con datos desagregados por sexo y mantener habilitado el canal de denuncia de la Ley Karin (Ley 21.643) para acoso laboral y sexual.',
    );
  }

  if (lens?.differentiatedBySex) {
    obligations.push(
      'Registrar la exposición desagregada por sexo y verificar si el peligro impacta de forma diferenciada (DS 44, enfoque de género).',
    );
  }

  if (input.disasterHazard) {
    const label = DISASTER_LABEL[input.disasterHazard];
    if (input.emergencyPlanInPlace) {
      obligations.push(
        `Amenaza de ${label}: mantener vigente el plan de emergencia y evacuación, con simulacros periódicos, zonas seguras señalizadas y roles de brigada asignados.`,
      );
    } else {
      obligations.push(
        `Amenaza de ${label}: elaborar el plan de emergencia y evacuación (zonas seguras, roles de brigada, simulacros periódicos). Sin plan vigente la amenaza no es tolerable.`,
      );
      escalate += 1;
    }
  }

  return { obligations, escalate, maxResidualSteps };
}

export function calculateIper(input: IperInput): IperResult {
  assertInRange('probability', input.probability);
  assertInRange('severity', input.severity);

  const baseLevel = IPER_MATRIX[input.probability - 1][input.severity - 1];
  const rawScore = input.probability * input.severity;

  const { obligations, escalate, maxResidualSteps } = evaluateDs44(input);
  const level = escalate > 0 ? escalateLevel(baseLevel, escalate) : baseLevel;
  const color = COLOR_BY_LEVEL[level];

  let residualLevel: IperLevel | undefined;
  if (input.controlEffectiveness !== undefined) {
    const stepsByControl: Record<NonNullable<IperInput['controlEffectiveness']>, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
    };
    const requested = stepsByControl[input.controlEffectiveness];
    const granted =
      maxResidualSteps === undefined ? requested : Math.min(requested, maxResidualSteps);
    residualLevel = reduceLevel(level, granted);
  }

  const result: IperResult = {
    rawScore,
    level,
    color,
    residualLevel,
    recommendation: RECOMMENDATION_BY_LEVEL[level],
  };

  // Kept undefined (not empty/false) with no DS 44 input so existing persisted
  // payloads and the 19 downstream consumers stay byte-identical.
  if (obligations.length > 0) result.ds44Obligations = obligations;
  if (level !== baseLevel) result.differentialEscalation = true;

  return result;
}
