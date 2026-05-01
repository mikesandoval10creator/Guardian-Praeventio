/**
 * IPER tests — Identificación de Peligros y Evaluación de Riesgos.
 * Reference: SUSESO Guía Técnica DS 40 / ACHS Manual IPER (5×5 matrix).
 */
import { describe, expect, it } from 'vitest';
import { calculateIper, IPER_MATRIX, type IperLevel } from './iper';

describe('calculateIper — full 5x5 matrix', () => {
  // The expected matrix per the spec. Rows are P=1..5, cols are S=1..5.
  const expected: IperLevel[][] = [
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
  ];

  for (let p = 1; p <= 5; p++) {
    for (let s = 1; s <= 5; s++) {
      it(`P=${p} S=${s} → ${expected[p - 1][s - 1]}`, () => {
        const r = calculateIper({
          probability: p as 1 | 2 | 3 | 4 | 5,
          severity: s as 1 | 2 | 3 | 4 | 5,
        });
        expect(r.level).toBe(expected[p - 1][s - 1]);
        expect(r.rawScore).toBe(p * s);
      });
    }
  }
});

describe('calculateIper — colors', () => {
  const colorByLevel: Record<IperLevel, string> = {
    trivial: '#22c55e',
    tolerable: '#eab308',
    moderado: '#f59e0b',
    importante: '#f97316',
    intolerable: '#ef4444',
  };
  it('maps each level to its color', () => {
    expect(calculateIper({ probability: 1, severity: 1 }).color).toBe(
      colorByLevel.trivial,
    );
    expect(calculateIper({ probability: 1, severity: 3 }).color).toBe(
      colorByLevel.tolerable,
    );
    expect(calculateIper({ probability: 3, severity: 3 }).color).toBe(
      colorByLevel.moderado,
    );
    expect(calculateIper({ probability: 4, severity: 4 }).color).toBe(
      colorByLevel.importante,
    );
    expect(calculateIper({ probability: 5, severity: 5 }).color).toBe(
      colorByLevel.intolerable,
    );
  });
});

describe('calculateIper — residual level (control effectiveness)', () => {
  it('controlEffectiveness=none does not change level', () => {
    const r = calculateIper({
      probability: 4,
      severity: 4,
      controlEffectiveness: 'none',
    });
    expect(r.level).toBe('importante');
    expect(r.residualLevel).toBe('importante');
  });

  it('controlEffectiveness=low reduces by 1 step', () => {
    const r = calculateIper({
      probability: 4,
      severity: 4,
      controlEffectiveness: 'low',
    });
    expect(r.residualLevel).toBe('moderado');
  });

  it('controlEffectiveness=medium reduces by 2 steps', () => {
    const r = calculateIper({
      probability: 4,
      severity: 4,
      controlEffectiveness: 'medium',
    });
    expect(r.residualLevel).toBe('tolerable');
  });

  it('controlEffectiveness=high reduces by 3 steps', () => {
    const r = calculateIper({
      probability: 4,
      severity: 4,
      controlEffectiveness: 'high',
    });
    expect(r.residualLevel).toBe('trivial');
  });

  it('residual is clamped at trivial', () => {
    const r = calculateIper({
      probability: 1,
      severity: 1,
      controlEffectiveness: 'high',
    });
    expect(r.residualLevel).toBe('trivial');
  });

  it('residual omitted when controlEffectiveness omitted', () => {
    const r = calculateIper({ probability: 3, severity: 3 });
    expect(r.residualLevel).toBeUndefined();
  });
});

describe('calculateIper — recommendation', () => {
  it('intolerable recommends stopping work', () => {
    const r = calculateIper({ probability: 5, severity: 5 });
    expect(r.recommendation.toLowerCase()).toMatch(/detener|parar|inmediat/);
  });
  it('trivial recommends monitoring', () => {
    const r = calculateIper({ probability: 1, severity: 1 });
    expect(r.recommendation.length).toBeGreaterThan(0);
  });
});

describe('calculateIper — invalid inputs', () => {
  it('throws if probability is 0', () => {
    expect(() =>
      calculateIper({
        probability: 0 as unknown as 1,
        severity: 3,
      }),
    ).toThrow(/probability/i);
  });

  it('throws if severity is 6', () => {
    expect(() =>
      calculateIper({
        probability: 3,
        severity: 6 as unknown as 5,
      }),
    ).toThrow(/severity/i);
  });

  it('throws on non-integer probability', () => {
    expect(() =>
      calculateIper({
        probability: 2.5 as unknown as 2,
        severity: 3,
      }),
    ).toThrow();
  });
});

describe('calculateIper — IPER_MATRIX shape', () => {
  it('is 5x5', () => {
    expect(IPER_MATRIX.length).toBe(5);
    for (const row of IPER_MATRIX) expect(row.length).toBe(5);
  });
});
