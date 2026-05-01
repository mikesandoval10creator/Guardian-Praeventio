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
 * Round 16 — removed dead path; institutional amplifier setting deferred
 * until customer ask. The previous `enableExposureAmplifier` flag was
 * never wired to any caller (no callsite set it to `true` anywhere in
 * `src/`). When a customer asks for a conservative jornada-amplifier
 * we'll add it back as a per-tenant institutional setting rather than a
 * silent per-call flag. The norm-strict implementation below is the
 * sole path now.
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

function factorIsAtRisk(c: TmertConditions): boolean {
  return c.A === true || c.B === true || c.C === true;
}

function classify(count: number): TmertRisk {
  if (count === 0) return 'bajo';
  if (count <= 2) return 'medio';
  return 'alto';
}

function recommend(risk: TmertRisk): string {
  if (risk === 'alto') {
    return 'Riesgo alto. Aplicar controles inmediatos y derivar al trabajador a evaluación médica (medicina del trabajo).';
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

  const overallRisk = classify(factorsAtRisk.length);

  return {
    factorsAtRisk,
    overallRisk,
    recommendation: recommend(overallRisk),
    requiresMedicalEvaluation: overallRisk === 'alto',
  };
}
