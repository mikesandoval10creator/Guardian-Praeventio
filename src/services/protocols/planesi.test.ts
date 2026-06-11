/**
 * PLANESI tests — Exposición ocupacional a sílice cristalina respirable.
 *
 * References (every boundary below is pinned against the official texts):
 * - DS 594/1999 MINSAL Art. 66 (LPP), Art. 62 (Fj, mod. Decreto 123/2014,
 *   D.O. 24-01-2015), Art. 63 (Fa) and Art. 64 (successive correction).
 * - MINSAL "Protocolo de Vigilancia del Ambiente de Trabajo y de la Salud de
 *   los Trabajadores con Exposición a Sílice" (Res. Ex. 268/2015, mod.
 *   Res. Ex. 1059/2016): Tabla 6-1 (LPP), Tabla 6-2 (Nivel de Riesgo →
 *   periodicidad ambiental), Tabla 7-1 (Grado de Exposición → periodicidad
 *   de vigilancia de la salud), Cap. IV letra n.1 (≥50% LPP = expuesto).
 */
import { describe, expect, it } from 'vitest';
import { evaluatePlanesi } from './planesi';

const base = { exposureHoursPerDay: 8 };

describe('evaluatePlanesi — LPP per silica type (DS 594 Art. 66 / Tabla 6-1)', () => {
  it('cuarzo is the default type with LPP 0,08 mg/m³', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.08 });
    expect(r.silicaType).toBe('cuarzo');
    expect(r.lppMgM3).toBe(0.08);
    expect(r.correctedLppMgM3).toBe(0.08);
    expect(r.percentOfLpp).toBeCloseTo(100, 9);
  });

  it('cristobalita has LPP 0,04 mg/m³', () => {
    const r = evaluatePlanesi({
      ...base,
      concentrationMgM3: 0.04,
      silicaType: 'cristobalita',
    });
    expect(r.lppMgM3).toBe(0.04);
    expect(r.percentOfLpp).toBeCloseTo(100, 9);
  });

  it('tridimita has LPP 0,04 mg/m³', () => {
    const r = evaluatePlanesi({
      ...base,
      concentrationMgM3: 0.02,
      silicaType: 'tridimita',
    });
    expect(r.lppMgM3).toBe(0.04);
    expect(r.percentOfLpp).toBeCloseTo(50, 9);
  });
});

describe('evaluatePlanesi — Nivel de Riesgo ambiental (Tabla 6-2)', () => {
  it('< 25% LPP → nivel 1, reevaluación cada 5 años', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.01 });
    expect(r.percentOfLpp).toBeCloseTo(12.5, 9);
    expect(r.ambientRiskLevel).toBe(1);
    expect(r.ambientReevaluation).toMatch(/cada 5 años/i);
  });

  it('exactly 25% LPP → nivel 2 ("mayor o igual al 25%"), cada 3 años', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.02 });
    expect(r.percentOfLpp).toBeCloseTo(25, 9);
    expect(r.ambientRiskLevel).toBe(2);
    expect(r.ambientReevaluation).toMatch(/cada 3 años/i);
  });

  it('just under 50% LPP → still nivel 2', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.039 });
    expect(r.ambientRiskLevel).toBe(2);
  });

  it('exactly 50% LPP → nivel 3 ("mayor o igual al 50%"), cada 2 años', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.04 });
    expect(r.percentOfLpp).toBeCloseTo(50, 9);
    expect(r.ambientRiskLevel).toBe(3);
    expect(r.ambientReevaluation).toMatch(/cada 2 años/i);
  });

  it('exactly 100% LPP → nivel 3 ("hasta el valor del LPP" inclusive)', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.08 });
    expect(r.ambientRiskLevel).toBe(3);
    expect(r.exceedsLegalLimit).toBe(false);
  });

  it('over 100% LPP → nivel 4, supera el límite legal', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.081 });
    expect(r.ambientRiskLevel).toBe(4);
    expect(r.exceedsLegalLimit).toBe(true);
    expect(r.ambientReevaluation).toMatch(/Autoridad Sanitaria/i);
  });
});

describe('evaluatePlanesi — Grado de Exposición / vigilancia salud (Tabla 7-1 + Cap. IV n.1)', () => {
  it('under 50% LPP → grado 0, sin ingreso cuantitativo a vigilancia', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.039 });
    expect(r.exposureGrade).toBe(0);
    expect(r.surveillanceRequired).toBe(false);
    expect(r.surveillancePeriodicity).toMatch(/no califica como expuesto/i);
  });

  it('exactly 50% LPP → grado 1, radiografía de tórax cada 2 años', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.04 });
    expect(r.exposureGrade).toBe(1);
    expect(r.surveillanceRequired).toBe(true);
    expect(r.surveillancePeriodicity).toMatch(/cada 2 años/i);
  });

  it('exactly 2× LPP (200%) → still grado 1 ("hasta 2 veces" inclusive)', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.16 });
    expect(r.percentOfLpp).toBeCloseTo(200, 9);
    expect(r.exposureGrade).toBe(1);
  });

  it('over 2× LPP → grado 2, vigilancia anual', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.161 });
    expect(r.exposureGrade).toBe(2);
    expect(r.surveillancePeriodicity).toMatch(/anual/i);
  });

  it('exactly 5× LPP (500%) → still grado 2 ("hasta 5 veces" inclusive)', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.4 });
    expect(r.percentOfLpp).toBeCloseTo(500, 9);
    expect(r.exposureGrade).toBe(2);
    expect(r.exceedsMaxPermitted).toBe(false);
  });

  it('over 5× LPP → grado 3, evaluación dentro de 60 días y luego anual', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.5 });
    expect(r.exposureGrade).toBe(3);
    expect(r.surveillancePeriodicity).toMatch(/60 días/i);
    // Concentración máxima permitida (def. a, Cap. IV): never above 5× LPP.
    expect(r.exceedsMaxPermitted).toBe(true);
  });

  it('actividad crítica (chorro de arena / chancador cuarzo) → vigilancia anual aunque esté bajo el 50% (Tabla 7-1 nota 1)', () => {
    const r = evaluatePlanesi({
      ...base,
      concentrationMgM3: 0.01,
      criticalSilicaTask: true,
    });
    expect(r.exposureGrade).toBe(0);
    expect(r.surveillanceRequired).toBe(true);
    expect(r.surveillancePeriodicity).toMatch(/anual/i);
  });

  it('actividad crítica en grado 3 conserva el plazo de 60 días', () => {
    const r = evaluatePlanesi({
      ...base,
      concentrationMgM3: 0.5,
      criticalSilicaTask: true,
    });
    expect(r.exposureGrade).toBe(3);
    expect(r.surveillancePeriodicity).toMatch(/60 días/i);
  });
});

describe('evaluatePlanesi — Fj jornada correction (DS 594 Art. 62, mod. D.123/2015)', () => {
  it('8 h/día sin jornada semanal informada → Fj = 1 (sin corrección)', () => {
    const r = evaluatePlanesi({ exposureHoursPerDay: 8, concentrationMgM3: 0.04 });
    expect(r.jornadaFactor).toBe(1);
    expect(r.correctedLppMgM3).toBe(0.08);
  });

  it('12 h/día → Fj = (8/12)·((24−12)/16) = 0,50; el LPP corregido baja a 0,04', () => {
    const r = evaluatePlanesi({ exposureHoursPerDay: 12, concentrationMgM3: 0.04 });
    expect(r.jornadaFactor).toBe(0.5);
    expect(r.correctedLppMgM3).toBeCloseTo(0.04, 12);
    expect(r.percentOfLpp).toBeCloseTo(100, 9);
    expect(r.ambientRiskLevel).toBe(3);
  });

  it('10 h/día → Fj = 0,70 (redondeo a 2 decimales exigido por la norma)', () => {
    const r = evaluatePlanesi({ exposureHoursPerDay: 10, concentrationMgM3: 0.04 });
    expect(r.jornadaFactor).toBe(0.7);
  });

  it('9 h/día → Fj = (8/9)·(15/16) = 0,8333… → 0,83', () => {
    const r = evaluatePlanesi({ exposureHoursPerDay: 9, concentrationMgM3: 0.04 });
    expect(r.jornadaFactor).toBe(0.83);
  });

  it('8 h/día con jornada semanal de 48 h → caso especial Fj = 0,90', () => {
    const r = evaluatePlanesi({
      exposureHoursPerDay: 8,
      weeklyHours: 48,
      concentrationMgM3: 0.04,
    });
    expect(r.jornadaFactor).toBe(0.9);
    expect(r.correctedLppMgM3).toBeCloseTo(0.072, 12);
  });

  it('8 h/día con 45 h semanales → sin corrección (el caso especial exige > 45 h)', () => {
    const r = evaluatePlanesi({
      exposureHoursPerDay: 8,
      weeklyHours: 45,
      concentrationMgM3: 0.04,
    });
    expect(r.jornadaFactor).toBe(1);
  });

  it('jornada diaria > 8 h prima sobre la jornada semanal (texto del Art. 62)', () => {
    const r = evaluatePlanesi({
      exposureHoursPerDay: 12,
      weeklyHours: 48,
      concentrationMgM3: 0.04,
    });
    expect(r.jornadaFactor).toBe(0.5);
  });
});

describe('evaluatePlanesi — Fa altitude correction (DS 594 Art. 63/64)', () => {
  it('presión 608 mmHg (>1.000 msnm) → Fa = 0,80', () => {
    const r = evaluatePlanesi({
      ...base,
      concentrationMgM3: 0.04,
      atmosphericPressureMmHg: 608,
    });
    expect(r.altitudeFactor).toBe(0.8);
    expect(r.correctedLppMgM3).toBeCloseTo(0.064, 12);
  });

  it('Art. 64: Fj y Fa se multiplican sucesivamente', () => {
    const r = evaluatePlanesi({
      exposureHoursPerDay: 12,
      concentrationMgM3: 0.032,
      atmosphericPressureMmHg: 608,
    });
    // 0,08 × 0,5 × 0,80 = 0,032 → 100% del LPP corregido.
    expect(r.correctedLppMgM3).toBeCloseTo(0.032, 12);
    expect(r.percentOfLpp).toBeCloseTo(100, 6);
  });

  it('sin presión informada → Fa = 1', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.04 });
    expect(r.altitudeFactor).toBe(1);
  });
});

describe('evaluatePlanesi — activación PLANESI (criterio 0,1 mg/m³ del procedimiento interno)', () => {
  it('0,1 mg/m³ exacto NO activa (el criterio es estrictamente mayor)', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.1 });
    expect(r.planesiActivated).toBe(false);
  });

  it('sobre 0,1 mg/m³ activa el programa', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.11 });
    expect(r.planesiActivated).toBe(true);
  });
});

describe('evaluatePlanesi — recomendación (jerarquía de control es-CL)', () => {
  it('nivel 4 exige sustitución / humectación / ventilación', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.2 });
    expect(r.recommendation).toMatch(/sustitución|humectación|ventilación/i);
  });

  it('sobre 5× LPP la recomendación exige medidas inmediatas (48 horas)', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.5 });
    expect(r.recommendation).toMatch(/48 horas/);
  });

  it('nivel 1 mantiene controles y reevalúa', () => {
    const r = evaluatePlanesi({ ...base, concentrationMgM3: 0.005 });
    expect(r.recommendation.length).toBeGreaterThan(0);
    expect(r.recommendation).toMatch(/mantener/i);
  });
});

describe('evaluatePlanesi — invalid inputs', () => {
  it('throws on negative concentration', () => {
    expect(() => evaluatePlanesi({ ...base, concentrationMgM3: -0.01 })).toThrow(/PLANESI:/);
  });

  it('throws on non-finite concentration', () => {
    expect(() => evaluatePlanesi({ ...base, concentrationMgM3: NaN })).toThrow(/PLANESI:/);
  });

  it('throws on exposure hours out of [0, 24]', () => {
    expect(() => evaluatePlanesi({ exposureHoursPerDay: 25, concentrationMgM3: 0.04 })).toThrow(/PLANESI:/);
    expect(() => evaluatePlanesi({ exposureHoursPerDay: -1, concentrationMgM3: 0.04 })).toThrow(/PLANESI:/);
  });

  it('throws on weekly hours out of (0, 168]', () => {
    expect(() =>
      evaluatePlanesi({ exposureHoursPerDay: 8, weeklyHours: 0, concentrationMgM3: 0.04 }),
    ).toThrow(/PLANESI:/);
    expect(() =>
      evaluatePlanesi({ exposureHoursPerDay: 8, weeklyHours: 169, concentrationMgM3: 0.04 }),
    ).toThrow(/PLANESI:/);
  });

  it('throws on atmospheric pressure out of a physical range', () => {
    expect(() =>
      evaluatePlanesi({ ...base, concentrationMgM3: 0.04, atmosphericPressureMmHg: 100 }),
    ).toThrow(/PLANESI:/);
    expect(() =>
      evaluatePlanesi({ ...base, concentrationMgM3: 0.04, atmosphericPressureMmHg: 900 }),
    ).toThrow(/PLANESI:/);
  });
});

describe('evaluatePlanesi — worked example (faena minera, turno 12 h)', () => {
  it('0,06 mg/m³ cuarzo a 12 h/día: LPP corregido 0,04 → 150% → nivel 4, grado 1', () => {
    const r = evaluatePlanesi({ exposureHoursPerDay: 12, concentrationMgM3: 0.06 });
    expect(r.correctedLppMgM3).toBeCloseTo(0.04, 12);
    expect(r.percentOfLpp).toBeCloseTo(150, 6);
    expect(r.ambientRiskLevel).toBe(4);
    expect(r.exposureGrade).toBe(1);
    expect(r.surveillanceRequired).toBe(true);
    expect(r.exceedsLegalLimit).toBe(true);
    expect(r.exceedsMaxPermitted).toBe(false);
  });
});
