/**
 * TMERT tests — Trastornos Musculoesqueléticos (extremidad superior).
 * Reference: MINSAL Norma Técnica TMERT-EESS (2012).
 */
import { describe, expect, it } from 'vitest';
import { evaluateTmert, type TmertInput } from './tmert';

const noConditions = { A: false, B: false, C: false } as const;

const baseInput: TmertInput = {
  repetitividad: { ...noConditions },
  fuerza: { ...noConditions },
  posturaForzada: { ...noConditions },
  otros: { ...noConditions },
  exposureHoursPerDay: 4,
};

describe('evaluateTmert — overall risk classification', () => {
  it('all factors free of risk → bajo', () => {
    const r = evaluateTmert(baseInput);
    expect(r.overallRisk).toBe('bajo');
    expect(r.factorsAtRisk).toEqual([]);
    expect(r.requiresMedicalEvaluation).toBe(false);
  });

  it('one factor at risk (A=true) → medio', () => {
    const r = evaluateTmert({
      ...baseInput,
      repetitividad: { A: true, B: false, C: false },
    });
    expect(r.overallRisk).toBe('medio');
    expect(r.factorsAtRisk).toEqual(['repetitividad']);
    expect(r.requiresMedicalEvaluation).toBe(false);
  });

  it('two factors at risk → medio (boundary)', () => {
    const r = evaluateTmert({
      ...baseInput,
      repetitividad: { A: true, B: false, C: false },
      fuerza: { A: false, B: true, C: false },
    });
    expect(r.overallRisk).toBe('medio');
    expect(r.factorsAtRisk).toHaveLength(2);
    expect(r.factorsAtRisk).toContain('repetitividad');
    expect(r.factorsAtRisk).toContain('fuerza');
  });

  it('three factors at risk → alto (boundary medio→alto)', () => {
    const r = evaluateTmert({
      ...baseInput,
      repetitividad: { A: true, B: false, C: false },
      fuerza: { A: false, B: true, C: false },
      posturaForzada: { A: false, B: false, C: true },
    });
    expect(r.overallRisk).toBe('alto');
    expect(r.factorsAtRisk).toHaveLength(3);
    expect(r.requiresMedicalEvaluation).toBe(true);
    expect(r.recommendation.toLowerCase()).toMatch(/médic|doctor|salud/);
  });

  it('four factors at risk → alto', () => {
    const r = evaluateTmert({
      ...baseInput,
      repetitividad: { A: true, B: false, C: false },
      fuerza: { A: true, B: false, C: false },
      posturaForzada: { A: true, B: false, C: false },
      otros: { A: true, B: false, C: false },
    });
    expect(r.overallRisk).toBe('alto');
    expect(r.factorsAtRisk).toHaveLength(4);
  });
});

describe('evaluateTmert — per-factor "Sí" rule', () => {
  it('any of {A,B,C} = true marks the factor at risk', () => {
    const r = evaluateTmert({
      ...baseInput,
      fuerza: { A: false, B: false, C: true },
    });
    expect(r.factorsAtRisk).toEqual(['fuerza']);
  });

  it('multiple conditions on the same factor count as a single factor', () => {
    const r = evaluateTmert({
      ...baseInput,
      posturaForzada: { A: true, B: true, C: true },
    });
    expect(r.factorsAtRisk).toEqual(['posturaForzada']);
    expect(r.overallRisk).toBe('medio');
  });
});

describe('evaluateTmert — exposure hours amplifier (opt-in)', () => {
  // Default mode (norm-strict): no flag set → exposure does NOT escalate.
  it('default (flag absent) — exposure > 6h with 2 factors stays medio', () => {
    const r = evaluateTmert({
      ...baseInput,
      repetitividad: { A: true, B: false, C: false },
      fuerza: { A: false, B: true, C: false },
      exposureHoursPerDay: 7,
    });
    expect(r.overallRisk).toBe('medio');
  });

  // Opt-in: flag true → escalation activates.
  it('flag enabled — exposure > 6h with 2 factors → escalates to alto', () => {
    const r = evaluateTmert({
      ...baseInput,
      repetitividad: { A: true, B: false, C: false },
      fuerza: { A: false, B: true, C: false },
      exposureHoursPerDay: 7,
      enableExposureAmplifier: true,
    });
    expect(r.overallRisk).toBe('alto');
    expect(r.recommendation.toLowerCase()).toMatch(/jornada|6 ?h|exposici/);
  });

  it('flag enabled — exposure > 6h with 0 factors stays bajo', () => {
    const r = evaluateTmert({
      ...baseInput,
      exposureHoursPerDay: 8,
      enableExposureAmplifier: true,
    });
    expect(r.overallRisk).toBe('bajo');
  });

  it('flag enabled — exposure exactly 6h is NOT amplified', () => {
    const r = evaluateTmert({
      ...baseInput,
      repetitividad: { A: true, B: false, C: false },
      exposureHoursPerDay: 6,
      enableExposureAmplifier: true,
    });
    expect(r.overallRisk).toBe('medio');
  });

  it('flag explicitly false — same as absent (norm-strict)', () => {
    const r = evaluateTmert({
      ...baseInput,
      repetitividad: { A: true, B: false, C: false },
      fuerza: { A: false, B: true, C: false },
      exposureHoursPerDay: 7,
      enableExposureAmplifier: false,
    });
    expect(r.overallRisk).toBe('medio');
  });
});

describe('evaluateTmert — invalid inputs', () => {
  it('throws on negative exposureHoursPerDay', () => {
    expect(() =>
      evaluateTmert({ ...baseInput, exposureHoursPerDay: -1 }),
    ).toThrow();
  });

  it('throws on exposureHoursPerDay > 24', () => {
    expect(() =>
      evaluateTmert({ ...baseInput, exposureHoursPerDay: 25 }),
    ).toThrow();
  });
});
