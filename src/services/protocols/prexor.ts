/**
 * PREXOR — Protocolo de Exposición Ocupacional al Ruido.
 *
 * Reference: DS 594 Art. 75 (Reglamento sobre Condiciones Sanitarias y
 * Ambientales Básicas en los Lugares de Trabajo) y MINSAL Decreto 685/2009
 * "Protocolo de Exposición Ocupacional al Ruido" (PREXOR).
 *
 * Daily noise dose:
 *   Dose% = Σ (C_i / T_i) × 100
 * where C_i is the duration in hours at level L_i (dB(A)) and T_i is the
 * maximum permissible duration at L_i, with the Chilean Q=3 dB exchange
 * rate:
 *   T(L) = 8 / 2^((L − 85) / 3)   for L ≥ 80 dB(A)
 *   T(L) = ∞ (no aporte de dosis) for L < 80 dB(A)
 *
 * Equivalent continuous level for 8 h (LAeq,8h) with Q=3 dB exchange rate
 * (consistent with DS 594 Art. 75 Chile):
 *   LAeq,8h = 85 + 3 × log2(dose/100)
 *           = 85 + (3 / log10(2)) × log10(dose/100)
 *
 * (Nota: la especificación original entregada al implementador menciona
 * `(10/log10(2)) × log10(dose/100)` — eso correspondería a un exchange rate
 * de 10 dB, no al Q=3 dB normado en Chile. Se sigue Q=3 por consistencia
 * con DS 594.)
 *
 * Action levels (PREXOR):
 *   Dose < 50%        → bajo
 *   50% ≤ Dose ≤ 100% → significativo
 *   100% < Dose ≤ 1000% → alto
 *   Dose > 1000%      → crítico
 *
 * Worked example: 8h @ 90 dB(A).
 *   T(90) = 8 / 2^((90-85)/3) = 8 / 2^(5/3) ≈ 8 / 3.1748 ≈ 2.5198 h
 *   dose = 8 / 2.5198 × 100 ≈ 317.5%  (alto)
 *   LAeq,8h ≈ 85 + (10/log10(2))*log10(3.175) ≈ 90 dB(A).
 */

export interface PrexorMeasurement {
  /** Duración en horas (C_i). Debe ser ≥ 0. */
  durationHours: number;
  /** Nivel de presión sonora en dB(A) (L_i). */
  levelDbA: number;
}

export type PrexorRisk = 'bajo' | 'significativo' | 'alto' | 'critico';

export interface PrexorResult {
  dosePercent: number;
  leqEq8hDbA: number;
  riskLevel: PrexorRisk;
  recommendation: string;
  exceedsLegalLimit: boolean;
}

const REFERENCE_LEVEL_DBA = 85;
const REFERENCE_DURATION_H = 8;
const EXCHANGE_RATE_DB = 3;
const COUNTING_THRESHOLD_DBA = 80;

function permissibleHours(levelDbA: number): number {
  // Returns +Infinity below 80 dB(A); at 85 dB(A) returns 8h; halves every +3 dB.
  if (levelDbA < COUNTING_THRESHOLD_DBA) return Number.POSITIVE_INFINITY;
  return (
    REFERENCE_DURATION_H /
    Math.pow(2, (levelDbA - REFERENCE_LEVEL_DBA) / EXCHANGE_RATE_DB)
  );
}

function classify(dosePercent: number): PrexorRisk {
  if (dosePercent < 50) return 'bajo';
  if (dosePercent <= 100) return 'significativo';
  if (dosePercent <= 1000) return 'alto';
  return 'critico';
}

function recommend(risk: PrexorRisk): string {
  switch (risk) {
    case 'critico':
      return 'Riesgo crítico. Ingreso inmediato al programa de vigilancia auditiva, retirar al trabajador de la fuente y aplicar controles de ingeniería.';
    case 'alto':
      return 'Riesgo alto. Audiometría anual, controles de ingeniería/administrativos y uso obligatorio de protección auditiva certificada.';
    case 'significativo':
      return 'Riesgo significativo. Vigilancia ambiental anual, capacitación y refuerzo del uso de protección auditiva.';
    case 'bajo':
      return 'Riesgo bajo. Mantener buenas prácticas y reevaluar al menos cada 3 años o ante cambios en el proceso.';
  }
}

function assertMeasurement(m: PrexorMeasurement, idx: number): void {
  if (!Number.isFinite(m.durationHours) || m.durationHours < 0) {
    throw new Error(
      `PREXOR: measurement[${idx}].durationHours must be a finite number ≥ 0 (received ${m.durationHours})`,
    );
  }
  if (!Number.isFinite(m.levelDbA) || m.levelDbA < 0) {
    throw new Error(
      `PREXOR: measurement[${idx}].levelDbA must be a finite non-negative number (received ${m.levelDbA})`,
    );
  }
}

export function calculatePrexor(
  measurements: PrexorMeasurement[],
): PrexorResult {
  let dose = 0;
  measurements.forEach((m, i) => {
    assertMeasurement(m, i);
    const t = permissibleHours(m.levelDbA);
    if (Number.isFinite(t) && t > 0) {
      dose += (m.durationHours / t) * 100;
    }
  });

  const leq =
    dose > 0
      ? REFERENCE_LEVEL_DBA +
        (EXCHANGE_RATE_DB / Math.log10(2)) * Math.log10(dose / 100)
      : 0;
  const risk = classify(dose);

  return {
    dosePercent: dose,
    leqEq8hDbA: leq,
    riskLevel: risk,
    recommendation: recommend(risk),
    exceedsLegalLimit: dose > 100,
  };
}
