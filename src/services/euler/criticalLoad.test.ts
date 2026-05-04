import { describe, it, expect } from 'vitest';
import {
  calculateCriticalLoad,
  bucklingSafetyFactor,
  rectangularInertia,
  circularSolidInertia,
  circularHollowInertia,
  EFFECTIVE_LENGTH_FACTORS,
} from './criticalLoad';

describe('criticalLoad — Euler buckling Pcr', () => {
  // Reference column for numerical pinning:
  //   E = 200 GPa (steel), I = 1e-6 m^4, L = 2 m, pinned-pinned.
  //   P_cr = π² · 200e9 · 1e-6 / (1·2)² = π² · 200000 / 4
  //        ≈ 493480.22 N ≈ 493.48 kN.
  const STEEL_E = 200e9;
  const I_REF = 1e-6;
  const L_REF = 2;

  it('pinned-pinned standard steel column → P_cr ≈ 493.48 kN', () => {
    const { criticalLoad } = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'pinned-pinned',
    });
    // Expect 493480.22 N, tolerate ±0.5%.
    expect(criticalLoad).toBeGreaterThan(493480 * 0.995);
    expect(criticalLoad).toBeLessThan(493480 * 1.005);
  });

  it('fixed-fixed yields ~4× the pinned-pinned Pcr (K=0.5 → 1/K² = 4)', () => {
    const pinned = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'pinned-pinned',
    }).criticalLoad;
    const fixed = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'fixed-fixed',
    }).criticalLoad;
    expect(fixed / pinned).toBeCloseTo(4, 6);
  });

  it('fixed-free (cantilever) yields 0.25× the pinned-pinned Pcr (K=2 → 1/K² = 0.25)', () => {
    const pinned = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'pinned-pinned',
    }).criticalLoad;
    const cantilever = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'fixed-free',
    }).criticalLoad;
    expect(cantilever / pinned).toBeCloseTo(0.25, 6);
  });

  it('fixed-pinned uses K=0.699 → ratio ≈ 1/0.699² ≈ 2.047 vs pinned-pinned', () => {
    const pinned = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'pinned-pinned',
    }).criticalLoad;
    const fp = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'fixed-pinned',
    }).criticalLoad;
    expect(fp / pinned).toBeCloseTo(1 / (0.699 * 0.699), 5);
  });

  it('returns the K factor and KL effective length in the result', () => {
    const r = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'fixed-free',
    });
    expect(r.K).toBe(2);
    expect(r.effectiveLength).toBe(4);
  });

  it('L=0 returns NaN criticalLoad (degenerate — division by zero)', () => {
    const r = calculateCriticalLoad({
      youngsModulus: STEEL_E,
      momentOfInertia: I_REF,
      length: 0,
      endConditions: 'pinned-pinned',
    });
    expect(Number.isNaN(r.criticalLoad)).toBe(true);
  });

  it('negative E returns NaN criticalLoad (non-physical material)', () => {
    const r = calculateCriticalLoad({
      youngsModulus: -200e9,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'pinned-pinned',
    });
    expect(Number.isNaN(r.criticalLoad)).toBe(true);
  });

  it('NaN inputs return NaN criticalLoad without throwing', () => {
    const r = calculateCriticalLoad({
      youngsModulus: NaN,
      momentOfInertia: I_REF,
      length: L_REF,
      endConditions: 'pinned-pinned',
    });
    expect(Number.isNaN(r.criticalLoad)).toBe(true);
  });

  it('EFFECTIVE_LENGTH_FACTORS contains all four end conditions', () => {
    expect(EFFECTIVE_LENGTH_FACTORS['fixed-fixed']).toBe(0.5);
    expect(EFFECTIVE_LENGTH_FACTORS['pinned-pinned']).toBe(1.0);
    expect(EFFECTIVE_LENGTH_FACTORS['fixed-pinned']).toBe(0.699);
    expect(EFFECTIVE_LENGTH_FACTORS['fixed-free']).toBe(2.0);
  });
});

describe('bucklingSafetyFactor', () => {
  it('appliedLoad=0 → +Infinity (no load, no risk)', () => {
    expect(bucklingSafetyFactor(1000, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('appliedLoad === criticalLoad → SF = 1', () => {
    expect(bucklingSafetyFactor(1000, 1000)).toBe(1);
  });

  it('appliedLoad > criticalLoad → SF < 1 (already failed)', () => {
    expect(bucklingSafetyFactor(1000, 2000)).toBe(0.5);
  });

  it('appliedLoad ≪ criticalLoad → SF ≫ 1 (safe)', () => {
    expect(bucklingSafetyFactor(10000, 1000)).toBe(10);
  });

  it('negative applied load (tension) returns +Infinity (no Euler buckling in tension)', () => {
    expect(bucklingSafetyFactor(1000, -500)).toBe(Number.POSITIVE_INFINITY);
  });

  it('NaN criticalLoad returns NaN', () => {
    expect(Number.isNaN(bucklingSafetyFactor(NaN, 100))).toBe(true);
  });
});

describe('section helpers — moment of inertia', () => {
  it('rectangularInertia(0.1, 0.2) = 0.1 · 0.2³ / 12 ≈ 6.667e-5', () => {
    expect(rectangularInertia(0.1, 0.2)).toBeCloseTo(6.66667e-5, 9);
  });

  it('circularSolidInertia(0.05) = π · 0.05⁴ / 64', () => {
    const expected = (Math.PI * Math.pow(0.05, 4)) / 64;
    expect(circularSolidInertia(0.05)).toBeCloseTo(expected, 12);
  });

  it('circularHollowInertia(0.1, 0.08) > 0 and < circularSolidInertia(0.1)', () => {
    const hollow = circularHollowInertia(0.1, 0.08);
    const solid = circularSolidInertia(0.1);
    expect(hollow).toBeGreaterThan(0);
    expect(hollow).toBeLessThan(solid);
  });

  it('circularHollowInertia with inner=0 equals circularSolidInertia (degenerate hollow)', () => {
    expect(circularHollowInertia(0.1, 0)).toBeCloseTo(circularSolidInertia(0.1), 12);
  });
});
