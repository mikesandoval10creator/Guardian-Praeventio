/**
 * TMERT — Trastornos Musculoesqueléticos Relacionados al Trabajo
 * (extremidad superior).
 *
 * Reference: MINSAL Chile, "Norma Técnica de Identificación y Evaluación
 * de Factores de Riesgo de Trastornos Musculoesqueléticos Relacionados al
 * Trabajo de Extremidades Superiores" (TMERT-EESS, 2012).
 *
 * The norm defines 4 evaluable factors (Repetitividad, Fuerza, Postura
 * Forzada, Otros — ambientales/organizacionales). Each factor has 3
 * conditions (A, B, C) marked Sí/No. A factor is "Riesgo" if ANY
 * condition is "Sí". Overall risk:
 *   - Bajo: 0 factors at risk
 *   - Medio: 1-2 factors at risk
 *   - Alto: 3-4 factors at risk
 *
 * Implementation note: the norm states that exposure must be evaluated
 * "durante la jornada laboral" but does NOT define a specific
 * exposure-time amplifier. We expose an OPTIONAL escalation
 * (`enableExposureAmplifier`, default false) that promotes the result to
 * "alto" when exposureHoursPerDay > 6 AND at least one factor is at risk.
 * This is an institutional/conservative extension — strict-norm callers
 * leave the flag false (the default).
 */

export type TmertFactor =
  | 'repetitividad'
  | 'fuerza'
  | 'posturaForzada'
  | 'otros';

export interface TmertConditions {
  A: boolean;
  B: boolean;
  C: boolean;
}

export interface TmertInput {
  repetitividad: TmertConditions;
  fuerza: TmertConditions;
  posturaForzada: TmertConditions;
  otros: TmertConditions;
  /** Horas de exposición efectiva al factor durante la jornada (0..24). */
  exposureHoursPerDay: number;
  /**
   * Cuando es true Y exposureHoursPerDay > 6 Y hay >= 1 factor en riesgo,
   * promueve la clasificación a 'alto'. Esta NO es una regla en la NT
   * MINSAL 2012; es una decisión institucional conservadora explícita.
   * Default: false (modo norma-estricta).
   */
  enableExposureAmplifier?: boolean;
}

export type TmertRisk = 'bajo' | 'medio' | 'alto';

export interface TmertResult {
  factorsAtRisk: TmertFactor[];
  overallRisk: TmertRisk;
  recommendation: string;
  requiresMedicalEvaluation: boolean;
}

const FACTOR_KEYS: TmertFactor[] = [
  'repetitividad',
  'fuerza',
  'posturaForzada',
  'otros',
];

const HIGH_EXPOSURE_THRESHOLD_HOURS = 6;

function factorIsAtRisk(c: TmertConditions): boolean {
  return c.A === true || c.B === true || c.C === true;
}

function classify(count: number): TmertRisk {
  if (count === 0) return 'bajo';
  if (count <= 2) return 'medio';
  return 'alto';
}

function recommend(
  risk: TmertRisk,
  amplifiedByExposure: boolean,
): string {
  if (risk === 'alto') {
    return amplifiedByExposure
      ? 'Riesgo alto amplificado por jornada >6 h. Aplicar controles inmediatos, derivar a evaluación médica y reducir tiempo de exposición.'
      : 'Riesgo alto. Aplicar controles inmediatos y derivar al trabajador a evaluación médica (medicina del trabajo).';
  }
  if (risk === 'medio') {
    return 'Riesgo medio. Implementar controles dentro de 60 días y monitorear la evolución de los factores.';
  }
  return 'Riesgo bajo. Mantener prácticas seguras y reevaluar al menos una vez al año.';
}

function assertExposure(hours: number): void {
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
    throw new Error(
      `TMERT: exposureHoursPerDay must be a finite number in [0,24] (received ${hours})`,
    );
  }
}

export function evaluateTmert(input: TmertInput): TmertResult {
  assertExposure(input.exposureHoursPerDay);

  const factorsAtRisk: TmertFactor[] = FACTOR_KEYS.filter((k) =>
    factorIsAtRisk(input[k]),
  );

  let overallRisk = classify(factorsAtRisk.length);
  let amplified = false;
  if (
    input.enableExposureAmplifier === true &&
    input.exposureHoursPerDay > HIGH_EXPOSURE_THRESHOLD_HOURS &&
    factorsAtRisk.length >= 1 &&
    overallRisk !== 'alto'
  ) {
    overallRisk = 'alto';
    amplified = true;
  }

  return {
    factorsAtRisk,
    overallRisk,
    recommendation: recommend(overallRisk, amplified),
    requiresMedicalEvaluation: overallRisk === 'alto',
  };
}
