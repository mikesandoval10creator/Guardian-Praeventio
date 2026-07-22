/**
 * IPER tests — Identificación de Peligros y Evaluación de Riesgos.
 * Reference: SUSESO Guía Técnica DS 44/2024 / ACHS Manual IPER (5×5 matrix).
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

// ─────────────────────────────────────────────────────────────────────────
// DS 44/2024 — the two dimensions the derogated DS 40 did not require.
//
// The lens RECOMMENDS, it never decides: it cites what the law requires and may
// SUGGEST a level, but `level` / `residualLevel` / `recommendation` are always
// the base engine's. Guardian designs the management; the prevencionista
// decides. That also makes it perfectly additive for the 19 consumers.
// ─────────────────────────────────────────────────────────────────────────

describe('DS 44 — backwards compatibility of the base matrix', () => {
  it('omits the DS 44 field entirely when no DS 44 input is given', () => {
    const r = calculateIper({ probability: 3, severity: 3 });
    expect(r.ds44Recommendations).toBeUndefined();
    expect(r.level).toBe('moderado');
  });
});

describe('DS 44 — enfoque de género (recomienda, no impone)', () => {
  it('never reclassifies the risk on its own — it suggests and cites the law', () => {
    const base = calculateIper({ probability: 3, severity: 3 });
    const r = calculateIper({
      probability: 3,
      severity: 3,
      genderLens: { maternityExposure: true },
    });
    // The computed classification is untouched: it stays the user's call.
    expect(r.level).toBe(base.level);
    expect(r.recommendation).toBe(base.recommendation);

    const rec = r.ds44Recommendations?.[0];
    expect(rec?.text).toMatch(/reasign|apartar/i);
    expect(rec?.basis).toMatch(/202/); // Código del Trabajo art. 202
    // Suggested only — shown next to the level, never applied.
    expect(rec?.suggestedLevel).toBe('importante');
  });

  it('offers no level suggestion when the consequence is not incapacitating (S<3)', () => {
    const r = calculateIper({
      probability: 3,
      severity: 2,
      genderLens: { maternityExposure: true },
    });
    expect(r.level).toBe('tolerable');
    expect(r.ds44Recommendations?.[0].suggestedLevel).toBeUndefined();
    expect(r.ds44Recommendations?.[0].text.length).toBeGreaterThan(0);
  });

  it('does not withdraw residual credit for ill-fitting PPE — it recommends', () => {
    const withoutGap = calculateIper({
      probability: 4,
      severity: 4,
      controlEffectiveness: 'high',
    });
    const withGap = calculateIper({
      probability: 4,
      severity: 4,
      controlEffectiveness: 'high',
      genderLens: { ppeAnthropometryGap: true },
    });
    // Same residual: the engine does not silently punish the user's input.
    expect(withGap.residualLevel).toBe(withoutGap.residualLevel);
    expect(withGap.ds44Recommendations?.[0].text).toMatch(/antropometr|talla/i);
    expect(withGap.ds44Recommendations?.[0].basis).toMatch(/DS 44|DS 594/);
  });

  it('points at the Ley Karin channel for gendered psychosocial hazards', () => {
    const r = calculateIper({
      probability: 3,
      severity: 3,
      genderLens: { genderedPsychosocial: true },
    });
    expect(r.ds44Recommendations?.[0].basis).toMatch(/21\.643|karin/i);
  });

  it('recommends sex-disaggregated records for sex-differentiated exposure', () => {
    const r = calculateIper({
      probability: 2,
      severity: 2,
      genderLens: { differentiatedBySex: true },
    });
    expect(r.ds44Recommendations?.[0].text).toMatch(/desagreg/i);
  });

  it('accumulates one recommendation per factor', () => {
    const r = calculateIper({
      probability: 3,
      severity: 3,
      genderLens: {
        maternityExposure: true,
        ppeAnthropometryGap: true,
        genderedPsychosocial: true,
        differentiatedBySex: true,
      },
    });
    expect(r.ds44Recommendations).toHaveLength(4);
    for (const rec of r.ds44Recommendations ?? []) {
      expect(rec.basis.length).toBeGreaterThan(0); // every claim cites its norm
    }
  });
});

describe('DS 44 — gestión de desastres (recomienda, no impone)', () => {
  it('suggests a higher level when no emergency plan is recorded, without applying it', () => {
    const base = calculateIper({ probability: 2, severity: 4 });
    const r = calculateIper({
      probability: 2,
      severity: 4,
      disasterHazard: 'sismo',
    });
    expect(r.level).toBe(base.level); // 'moderado' — unchanged
    const rec = r.ds44Recommendations?.[0];
    expect(rec?.text).toMatch(/plan de emergencia|evacuaci/i);
    expect(rec?.suggestedLevel).toBe('importante');
  });

  it('recommends keeping drills current when a plan is already in place', () => {
    const r = calculateIper({
      probability: 2,
      severity: 4,
      disasterHazard: 'sismo',
      emergencyPlanInPlace: true,
    });
    expect(r.level).toBe('moderado');
    const rec = r.ds44Recommendations?.[0];
    expect(rec?.text).toMatch(/simulacro/i);
    expect(rec?.suggestedLevel).toBeUndefined(); // nothing to escalate
  });

  it('clamps the suggested level at intolerable', () => {
    const r = calculateIper({
      probability: 5,
      severity: 5,
      disasterHazard: 'tsunami',
    });
    expect(r.level).toBe('intolerable');
    expect(r.ds44Recommendations?.[0].suggestedLevel).toBe('intolerable');
  });
});
