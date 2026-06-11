/**
 * PLANESI — Exposición ocupacional a sílice cristalina respirable.
 *
 * Pure exposure-evaluation engine (rule #9: no side effects, deterministic).
 * ADR 0012: this module evaluates ENVIRONMENTAL exposure and the surveillance
 * periodicity the MINSAL protocol mandates; it never produces a health
 * verdict — the calificación belongs to the médico del organismo
 * administrador (Ley 16.744).
 *
 * LEGAL SOURCE — every constant below was transcribed from official texts
 * (verified 2026-06-11 against BCN/MINSAL copies):
 *
 * 1. DS 594/1999 MINSAL Art. 66 (texto consolidado BCN, idNorma=167766) and
 *    Tabla 6-1 of the protocol below — Límites Permisibles Ponderados,
 *    fracción respirable: cuarzo 0,08 mg/m³ · cristobalita 0,04 mg/m³ ·
 *    tridimita 0,04 mg/m³. Valid for 8 h/día, 48 h semanales, ≤1.000 msnm.
 * 2. DS 594 Art. 62 (modificado por Decreto 123/2014 MINSAL, D.O.
 *    24-01-2015): when the jornada exceeds 8 horas DIARIAS the LPP is
 *    multiplied by Fj = (8/h) × ((24 − h) / 16), h = horas trabajadas
 *    diarias. Special case: jornada of 8 h/día with a weekly total above 45
 *    and up to 48 hours → Fj = 0,90. Fj is expressed with two decimals,
 *    rounding the second up when the third decimal is ≥ 5.
 * 3. DS 594 Art. 63: above 1.000 msnm the LPP is multiplied by
 *    Fa = P / 760 (P = local atmospheric pressure in mmHg), same 2-decimal
 *    rounding. Art. 64: Fj and Fa are applied successively.
 * 4. MINSAL "Protocolo de Vigilancia del Ambiente de Trabajo y de la Salud
 *    de los Trabajadores con Exposición a Sílice" (Res. Ex. 268/2015,
 *    modificada por Res. Ex. 1059/2016 — the PLANESI surveillance protocol):
 *    - Tabla 6-2 (vigilancia AMBIENTAL — Nivel de Riesgo, Cpp vs LPP
 *      corregido): NR1 < 25% → cada 5 años · NR2 ≥ 25% y < 50% → cada 3
 *      años · NR3 ≥ 50% y hasta el valor del LPP → cada 2 años · NR4 supera
 *      el LPP → medidas inmediatas + notificación a la Autoridad Sanitaria
 *      Regional (6.6.1.1); sobre 5× LPP la prescripción es dentro de 48
 *      horas (6.6.1.1 letra e, Res. Ex. 1059/2016).
 *    - Cap. IV letra n.1: "trabajador expuesto" (entra a vigilancia de la
 *      salud) cuando la Cpp alcanza el 50% o más del LPP corregido.
 *    - Tabla 7-1 (vigilancia de la SALUD — Grado de Exposición): GE1 ≥ 50%
 *      del LPP y hasta 2× LPP → radiografía de tórax cada 2 años · GE2 > 2×
 *      y hasta 5× LPP → anual · GE3 > 5× LPP → evaluación dentro de 60 días
 *      y luego anual. Nota (1): limpieza abrasiva con chorro de arena y
 *      operadores de chancadores de cuarzo se controlan ANUALMENTE aunque la
 *      Cpp esté bajo el 50% del LPP (concordante con Cap. IV n.2 inciso 2°,
 *      exposición aguda).
 *    - Cap. IV letra a: Concentración Máxima Permitida = no superar 5 veces
 *      el LPP ni siquiera momentáneamente (también DS 594 Art. 60).
 * 5. Activación "> 0,1 mg/m³ de sílice libre cristalizada": criterio del
 *    procedimiento interno proto-planesi (src/contexts/NormativeContext.tsx,
 *    'proto-planesi' step 3). NOT found verbatim in the official protocol
 *    text — the official quantitative entry criteria are the ≥ 50%-LPP /
 *    Nivel-de-Riesgo thresholds above. Kept as an additional, more
 *    conservative-looking flag for continuity with the in-app procedure;
 *    pending primary-source verification of the 2015 PLANESI plan document.
 */

export type SilicaType = 'cuarzo' | 'cristobalita' | 'tridimita';

export interface PlanesiInput {
  /**
   * Concentración promedio ponderada (Cpp) de sílice cristalina en fracción
   * respirable, mg/m³ (muestreo personal representativo, ≥ 0).
   */
  concentrationMgM3: number;
  /** Horas trabajadas por día (0..24) — "h" del Art. 62 DS 594. */
  exposureHoursPerDay: number;
  /**
   * Horas semanales de la jornada (opcional, 0 < h ≤ 168). Solo se usa para
   * el caso especial del Art. 62: 8 h/día con total semanal > 45 y ≤ 48 →
   * Fj = 0,90. Si se omite, no se aplica ese caso.
   */
  weeklyHours?: number;
  /** Tipo de sílice libre cristalizada (Tabla 6-1). Default: cuarzo. */
  silicaType?: SilicaType;
  /**
   * Presión atmosférica local en mmHg (opcional, 400..800). Entregar SOLO
   * para faenas sobre 1.000 msnm (Art. 63 DS 594); aplica Fa = P/760.
   */
  atmosphericPressureMmHg?: number;
  /**
   * Tarea de exposición aguda controlada anualmente sin importar la Cpp
   * (Tabla 7-1 nota 1): limpieza abrasiva con chorro de arena u operación de
   * chancadores de cuarzo.
   */
  criticalSilicaTask?: boolean;
}

/** Tabla 6-2 — Nivel de Riesgo de la vigilancia ambiental. */
export type PlanesiAmbientRiskLevel = 1 | 2 | 3 | 4;

/**
 * Tabla 7-1 — Grado de Exposición de la vigilancia de la salud. Grade 0 is
 * our explicit "bajo el 50% del LPP" bucket (the table starts at GE1).
 */
export type PlanesiExposureGrade = 0 | 1 | 2 | 3;

export interface PlanesiResult {
  silicaType: SilicaType;
  /** LPP base de la Tabla 6-1 / DS 594 Art. 66, mg/m³. */
  lppMgM3: number;
  /** Factor Fj del Art. 62 (1 cuando no corresponde corregir). */
  jornadaFactor: number;
  /** Factor Fa del Art. 63 (1 cuando no se informa presión). */
  altitudeFactor: number;
  /** LPP corregido = LPP × Fj × Fa (Art. 64), mg/m³. */
  correctedLppMgM3: number;
  /** Cpp como % del LPP corregido. */
  percentOfLpp: number;
  ambientRiskLevel: PlanesiAmbientRiskLevel;
  /** Periodicidad de la reevaluación ambiental (es-CL, Tabla 6-2). */
  ambientReevaluation: string;
  exposureGrade: PlanesiExposureGrade;
  /** ≥ 50% del LPP corregido (Cap. IV n.1) o tarea crítica (Tabla 7-1 n.1). */
  surveillanceRequired: boolean;
  /** Periodicidad de la vigilancia de la salud (es-CL, Tabla 7-1). */
  surveillancePeriodicity: string;
  /** Criterio interno proto-planesi: Cpp > 0,1 mg/m³ (ver LEGAL SOURCE 5). */
  planesiActivated: boolean;
  /** Cpp supera el LPP corregido (Nivel de Riesgo 4). */
  exceedsLegalLimit: boolean;
  /** Cpp supera 5× el LPP corregido (Concentración Máxima Permitida). */
  exceedsMaxPermitted: boolean;
  /** Jerarquía de control recomendada (es-CL). */
  recommendation: string;
}

// LEGAL SOURCE 1 — DS 594 Art. 66 / Protocolo sílice Tabla 6-1.
const LPP_MG_M3: Record<SilicaType, number> = {
  cuarzo: 0.08,
  cristobalita: 0.04,
  tridimita: 0.04,
};

// LEGAL SOURCE 5 — in-repo proto-planesi step 3 (NormativeContext.tsx).
const ACTIVATION_THRESHOLD_MG_M3 = 0.1;

const REFERENCE_DAILY_HOURS = 8;

/** Norm-mandated 2-decimal rounding (Art. 62/63: "elevando el segundo…"). */
function roundFactor(f: number): number {
  return Math.round(f * 100) / 100;
}

// LEGAL SOURCE 2 — DS 594 Art. 62 (mod. Decreto 123/2014).
function jornadaFactor(dailyHours: number, weeklyHours?: number): number {
  if (dailyHours > REFERENCE_DAILY_HOURS) {
    return roundFactor((8 / dailyHours) * ((24 - dailyHours) / 16));
  }
  if (
    weeklyHours !== undefined &&
    dailyHours === REFERENCE_DAILY_HOURS &&
    weeklyHours > 45 &&
    weeklyHours <= 48
  ) {
    return 0.9;
  }
  return 1;
}

// LEGAL SOURCE 3 — DS 594 Art. 63.
function altitudeFactor(pressureMmHg?: number): number {
  if (pressureMmHg === undefined) return 1;
  return roundFactor(pressureMmHg / 760);
}

// LEGAL SOURCE 4 — Tabla 6-2.
function classifyAmbient(percentOfLpp: number): PlanesiAmbientRiskLevel {
  if (percentOfLpp < 25) return 1;
  if (percentOfLpp < 50) return 2;
  if (percentOfLpp <= 100) return 3;
  return 4;
}

function ambientReevaluation(level: PlanesiAmbientRiskLevel): string {
  switch (level) {
    case 1:
      return 'Nivel de Riesgo 1 (Cpp < 25% del LPP): reevaluación ambiental cada 5 años.';
    case 2:
      return 'Nivel de Riesgo 2 (Cpp ≥ 25% y < 50% del LPP): reevaluación ambiental cada 3 años.';
    case 3:
      return 'Nivel de Riesgo 3 (Cpp ≥ 50% del LPP y hasta el LPP): reevaluación ambiental cada 2 años.';
    case 4:
      return 'Nivel de Riesgo 4 (Cpp sobre el LPP): el organismo administrador debe prescribir medidas de control inmediatas y notificar a la Autoridad Sanitaria Regional (protocolo sílice MINSAL, 6.6.1.1); reevaluar tras corregir.';
  }
}

// LEGAL SOURCE 4 — Tabla 7-1 + Cap. IV n.1.
function classifyExposureGrade(percentOfLpp: number): PlanesiExposureGrade {
  if (percentOfLpp < 50) return 0;
  if (percentOfLpp <= 200) return 1;
  if (percentOfLpp <= 500) return 2;
  return 3;
}

function surveillancePeriodicity(
  grade: PlanesiExposureGrade,
  criticalSilicaTask: boolean,
): string {
  switch (grade) {
    case 3:
      return 'Grado de Exposición 3 (sobre 5× LPP): evaluación radiográfica de tórax dentro de 60 días desde conocidos los resultados y luego anual (Tabla 7-1).';
    case 2:
      return 'Grado de Exposición 2 (sobre 2× y hasta 5× LPP): radiografía de tórax anual (Tabla 7-1).';
    case 1:
      if (criticalSilicaTask) {
        return 'Grado de Exposición 1 con tarea de exposición aguda (chorro de arena / chancador de cuarzo): control anual (Tabla 7-1, nota 1).';
      }
      return 'Grado de Exposición 1 (≥ 50% y hasta 2× LPP): radiografía de tórax cada 2 años (Tabla 7-1).';
    case 0:
      if (criticalSilicaTask) {
        return 'Tarea de exposición aguda (chorro de arena / chancador de cuarzo): control anual aunque la Cpp esté bajo el 50% del LPP (Tabla 7-1, nota 1).';
      }
      return 'Cpp bajo el 50% del LPP: el trabajador no califica como expuesto por el criterio cuantitativo (protocolo sílice MINSAL, Cap. IV letra n.1); mantener la vigilancia ambiental.';
  }
}

function recommend(
  level: PlanesiAmbientRiskLevel,
  exceedsMaxPermitted: boolean,
): string {
  if (exceedsMaxPermitted) {
    return 'Condición crítica: la concentración supera 5 veces el LPP (Concentración Máxima Permitida). Detener la tarea generadora de polvo, exigir al organismo administrador la prescripción de medidas inmediatas dentro de 48 horas y aplicar la jerarquía completa: sustitución de sílice, humectación, ventilación local exhaustora y cabinas presurizadas; respirador P100 con prueba de ajuste solo como último recurso.';
  }
  switch (level) {
    case 4:
      return 'Supera el LPP. Implementar controles según jerarquía: sustitución del material con sílice, humectación de polvos, ventilación local exhaustora y cabinas cerradas con filtro; respirador con filtro P100 y prueba de ajuste anual solo como último recurso mientras se corrige el origen.';
    case 3:
      return 'Exposición significativa (≥ 50% del LPP). Reforzar controles de ingeniería (humectación, encapsulamiento), mantener el programa de vigilancia de la salud y verificar el uso correcto de protección respiratoria certificada.';
    case 2:
      return 'Exposición moderada (25–50% del LPP). Mantener los controles existentes, capacitar a los trabajadores de sectores con sílice y reevaluar el ambiente cada 3 años o ante cambios del proceso.';
    case 1:
      return 'Exposición baja (< 25% del LPP). Mantener las buenas prácticas de control de polvo y reevaluar el ambiente cada 5 años o ante cambios del proceso.';
  }
}

function assertInput(input: PlanesiInput): void {
  const { concentrationMgM3, exposureHoursPerDay, weeklyHours, atmosphericPressureMmHg } = input;
  if (!Number.isFinite(concentrationMgM3) || concentrationMgM3 < 0) {
    throw new Error(
      `PLANESI: concentrationMgM3 must be a finite number ≥ 0 (received ${concentrationMgM3})`,
    );
  }
  if (
    !Number.isFinite(exposureHoursPerDay) ||
    exposureHoursPerDay < 0 ||
    exposureHoursPerDay > 24
  ) {
    throw new Error(
      `PLANESI: exposureHoursPerDay must be a finite number in [0,24] (received ${exposureHoursPerDay})`,
    );
  }
  if (
    weeklyHours !== undefined &&
    (!Number.isFinite(weeklyHours) || weeklyHours <= 0 || weeklyHours > 168)
  ) {
    throw new Error(
      `PLANESI: weeklyHours must be a finite number in (0,168] (received ${weeklyHours})`,
    );
  }
  if (
    atmosphericPressureMmHg !== undefined &&
    (!Number.isFinite(atmosphericPressureMmHg) ||
      atmosphericPressureMmHg < 400 ||
      atmosphericPressureMmHg > 800)
  ) {
    throw new Error(
      `PLANESI: atmosphericPressureMmHg must be a finite number in [400,800] (received ${atmosphericPressureMmHg})`,
    );
  }
}

export function evaluatePlanesi(input: PlanesiInput): PlanesiResult {
  assertInput(input);

  const silicaType: SilicaType = input.silicaType ?? 'cuarzo';
  const lpp = LPP_MG_M3[silicaType];
  const fj = jornadaFactor(input.exposureHoursPerDay, input.weeklyHours);
  const fa = altitudeFactor(input.atmosphericPressureMmHg);
  const correctedLpp = lpp * fj * fa;
  const percentOfLpp = (input.concentrationMgM3 / correctedLpp) * 100;

  const ambientRiskLevel = classifyAmbient(percentOfLpp);
  const exposureGrade = classifyExposureGrade(percentOfLpp);
  const criticalSilicaTask = input.criticalSilicaTask === true;
  const exceedsMaxPermitted = percentOfLpp > 500;

  return {
    silicaType,
    lppMgM3: lpp,
    jornadaFactor: fj,
    altitudeFactor: fa,
    correctedLppMgM3: correctedLpp,
    percentOfLpp,
    ambientRiskLevel,
    ambientReevaluation: ambientReevaluation(ambientRiskLevel),
    exposureGrade,
    surveillanceRequired: exposureGrade >= 1 || criticalSilicaTask,
    surveillancePeriodicity: surveillancePeriodicity(exposureGrade, criticalSilicaTask),
    planesiActivated: input.concentrationMgM3 > ACTIVATION_THRESHOLD_MG_M3,
    exceedsLegalLimit: percentOfLpp > 100,
    exceedsMaxPermitted,
    recommendation: recommend(ambientRiskLevel, exceedsMaxPermitted),
  };
}
