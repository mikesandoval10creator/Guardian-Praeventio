/**
 * PREXOR tests — Protocolo de Exposición Ocupacional al Ruido.
 * Reference: Chile DS 594 Art. 75 + MINSAL Decreto 685/2009 (PREXOR).
 */
import { describe, expect, it } from 'vitest';
import { calculatePrexor } from './prexor';

describe('calculatePrexor — empty / silence', () => {
  it('empty array → dose 0, leq 0, level bajo', () => {
    const r = calculatePrexor([]);
    expect(r.dosePercent).toBe(0);
    expect(r.leqEq8hDbA).toBe(0);
    expect(r.riskLevel).toBe('bajo');
    expect(r.exceedsLegalLimit).toBe(false);
  });

  it('measurements below 80 dB(A) are not counted', () => {
    const r = calculatePrexor([
      { durationHours: 8, levelDbA: 75 },
    ]);
    expect(r.dosePercent).toBe(0);
    expect(r.riskLevel).toBe('bajo');
  });
});

describe('calculatePrexor — DS 594 limit (85 dB(A) for 8h)', () => {
  it('8h at 85 dB(A) → dose 100, leq 85, significativo', () => {
    const r = calculatePrexor([{ durationHours: 8, levelDbA: 85 }]);
    expect(r.dosePercent).toBeCloseTo(100, 6);
    expect(r.leqEq8hDbA).toBeCloseTo(85, 6);
    // Border 50-100% inclusive: dose=100 is "significativo".
    expect(r.riskLevel).toBe('significativo');
    expect(r.exceedsLegalLimit).toBe(false);
  });

  it('8h at 88 dB(A) → dose 200, leq 88, alto', () => {
    const r = calculatePrexor([{ durationHours: 8, levelDbA: 88 }]);
    expect(r.dosePercent).toBeCloseTo(200, 4);
    expect(r.leqEq8hDbA).toBeCloseTo(88, 4);
    expect(r.riskLevel).toBe('alto');
    expect(r.exceedsLegalLimit).toBe(true);
  });

  it('4h at 85 + 4h <80 → dose 50, level significativo (50% inclusive)', () => {
    const r = calculatePrexor([
      { durationHours: 4, levelDbA: 85 },
      { durationHours: 4, levelDbA: 70 },
    ]);
    expect(r.dosePercent).toBeCloseTo(50, 6);
    // Documented choice: 50% boundary belongs to "significativo" (50-100%).
    expect(r.riskLevel).toBe('significativo');
  });

  it('1h at 100 dB(A) — dose ~ 100/T(100)*100', () => {
    // T(100) = 8 / 2^((100-85)/3) = 8 / 2^5 = 8/32 = 0.25 h
    // dose = 1/0.25 * 100 = 400%
    const r = calculatePrexor([{ durationHours: 1, levelDbA: 100 }]);
    expect(r.dosePercent).toBeCloseTo(400, 4);
    expect(r.riskLevel).toBe('alto');
    expect(r.exceedsLegalLimit).toBe(true);
    // With Q=3 dB exchange rate (DS 594 Chile):
    //   leq = 85 + 3*log2(dose/100) = 85 + 3*log2(4) = 85 + 6 = 91 dB(A).
    // (La especificación originalmente sugería (10/log10(2)) — ese factor
    //  corresponde a Q=10. Ver comentario de divergencia en prexor.ts.)
    expect(r.leqEq8hDbA).toBeCloseTo(91, 4);
  });
});

describe('calculatePrexor — risk levels (PREXOR thresholds)', () => {
  it('dose 25% → bajo', () => {
    // 2h at 85 → dose = 2/8 * 100 = 25%
    const r = calculatePrexor([{ durationHours: 2, levelDbA: 85 }]);
    expect(r.dosePercent).toBeCloseTo(25, 6);
    expect(r.riskLevel).toBe('bajo');
  });

  it('dose 1500% → critico (>1000%)', () => {
    // 4h at 100 → dose = 4/0.25 * 100 = 1600%
    const r = calculatePrexor([{ durationHours: 4, levelDbA: 100 }]);
    expect(r.dosePercent).toBeCloseTo(1600, 1);
    expect(r.riskLevel).toBe('critico');
    expect(r.exceedsLegalLimit).toBe(true);
  });

  it('exact 1000% → alto (boundary, 100..1000 inclusive)', () => {
    // We hit dose 1000% by 2.5h@100 → 2.5/0.25 * 100 = 1000.
    const r = calculatePrexor([{ durationHours: 2.5, levelDbA: 100 }]);
    expect(r.dosePercent).toBeCloseTo(1000, 4);
    expect(r.riskLevel).toBe('alto');
  });
});

describe('calculatePrexor — sum across multiple measurements', () => {
  it('3 measurements add doses correctly', () => {
    // (a) 4h @ 85 → 50%
    // (b) 2h @ 88 → T(88) = 8/2^1 = 4h → 2/4 * 100 = 50%
    // (c) 1h @ 91 → T(91) = 8/2^2 = 2h → 1/2 * 100 = 50%
    // total = 150% → alto
    const r = calculatePrexor([
      { durationHours: 4, levelDbA: 85 },
      { durationHours: 2, levelDbA: 88 },
      { durationHours: 1, levelDbA: 91 },
    ]);
    expect(r.dosePercent).toBeCloseTo(150, 4);
    expect(r.riskLevel).toBe('alto');
  });
});

describe('calculatePrexor — invalid inputs', () => {
  it('throws on negative dB', () => {
    expect(() =>
      calculatePrexor([{ durationHours: 1, levelDbA: -5 }]),
    ).toThrow();
  });

  it('throws on negative hours', () => {
    expect(() =>
      calculatePrexor([{ durationHours: -1, levelDbA: 85 }]),
    ).toThrow();
  });

  it('throws on non-finite dB', () => {
    expect(() =>
      calculatePrexor([{ durationHours: 1, levelDbA: NaN }]),
    ).toThrow();
  });
});

describe('calculatePrexor — recommendation', () => {
  it('critico mentions ingreso al programa', () => {
    const r = calculatePrexor([{ durationHours: 8, levelDbA: 110 }]);
    expect(r.riskLevel).toBe('critico');
    expect(r.recommendation.toLowerCase()).toMatch(/programa|ingreso|inmediat/);
  });
  it('bajo recommends maintaining', () => {
    const r = calculatePrexor([{ durationHours: 1, levelDbA: 80 }]);
    expect(r.riskLevel).toBe('bajo');
    expect(r.recommendation.length).toBeGreaterThan(0);
  });
});

describe('calculatePrexor — worked example from header comment (Q=3)', () => {
  it('8h at 90 dB(A) → dose ≈ 317.5%, LAeq ≈ 90 dB(A) (alto)', () => {
    // T(90) = 8 / 2^((90-85)/3) = 8 / 2^(5/3) ≈ 2.5198 h
    // dose = 8 / 2.5198 * 100 ≈ 317.48%
    // LAeq = 85 + (3/log10(2))*log10(dose/100) = 90.000 dB(A)
    // The header comment previously wrote (10/log10(2)) (Q=10 factor) which
    // would give ≈101.67, contradicting its own '≈ 90' claim. With the
    // corrected (3/log10(2)) factor the code value matches the comment.
    const r = calculatePrexor([{ durationHours: 8, levelDbA: 90 }]);
    expect(r.dosePercent).toBeCloseTo(317.48, 1);
    expect(r.leqEq8hDbA).toBeCloseTo(90, 4);
    expect(r.riskLevel).toBe('alto');
    expect(r.exceedsLegalLimit).toBe(true);
  });

  it('the Q=10 factor would NOT yield 90 dB(A) (guards against comment regression)', () => {
    // Sanity: confirm the corrected factor (3) — not 10 — is what the engine
    // uses. If someone re-introduces the 10 factor in the code, LAeq jumps to
    // ~101.67 and this test fails.
    const r = calculatePrexor([{ durationHours: 8, levelDbA: 90 }]);
    const q10 = 85 + (10 / Math.log10(2)) * Math.log10(r.dosePercent / 100);
    expect(q10).toBeCloseTo(101.67, 1);
    expect(r.leqEq8hDbA).not.toBeCloseTo(q10, 1);
  });
});
