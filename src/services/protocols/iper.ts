/**
 * IPER — Identificación de Peligros y Evaluación de Riesgos.
 *
 * Reference: SUSESO Guía Técnica DS 40 (Reglamento del Sistema de Gestión de
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

export interface IperInput {
  /** 1 = raro, 5 = casi cierto */
  probability: 1 | 2 | 3 | 4 | 5;
  /** 1 = insignificante, 5 = catastrófico */
  severity: 1 | 2 | 3 | 4 | 5;
  /** Optional residual modifier (effectiveness of existing controls). */
  controlEffectiveness?: 'none' | 'low' | 'medium' | 'high';
}

export interface IperResult {
  rawScore: number;
  level: IperLevel;
  color: IperColor;
  residualLevel?: IperLevel;
  recommendation: string;
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

  return {
    rawScore,
    level,
    color,
    residualLevel,
    recommendation: RECOMMENDATION_BY_LEVEL[level],
  };
}
