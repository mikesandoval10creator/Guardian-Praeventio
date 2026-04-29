import { describe, it, expect } from 'vitest';
import { calculateReba, type RebaInput } from './reba';

// Helper: builds a fully-neutral input. Lower arm uses 70° because the
// REBA "neutral" lower-arm score (1) is the 60-100° range; the flexion
// of a relaxed standing forearm sits in that band.
const neutral = (): RebaInput => ({
  trunk: { flexionDeg: 0 },
  neck: { flexionDeg: 0 },
  legs: { bilateralSupport: true, kneeFlexionDeg: 0 },
  upperArm: { flexionDeg: 0 },
  lowerArm: { flexionDeg: 70 },
  wrist: { flexionDeg: 0 },
  load: { kg: 0 },
  coupling: 'good',
  activity: {},
});

// ─────────────────────────────────────────────────────────────────────
// 1. Neutral baseline
// ─────────────────────────────────────────────────────────────────────
describe('calculateReba — neutral baseline', () => {
  it('neutral standing posture, no load, good coupling, no activity → score 1, negligible', () => {
    const r = calculateReba(neutral());
    expect(r.scoreA).toBe(1);
    expect(r.scoreB).toBe(1);
    expect(r.scoreC).toBe(1);
    expect(r.activityScore).toBe(0);
    expect(r.finalScore).toBe(1);
    expect(r.actionLevel).toBe('negligible');
    expect(typeof r.recommendation).toBe('string');
    expect(r.recommendation.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Trunk score boundaries (1, 2, 3, 4) at 0°, 1°, 21°, 61°
// ─────────────────────────────────────────────────────────────────────
describe('trunk score boundaries', () => {
  // Helper that isolates the trunk: returns the Table-A value, which equals
  // the trunk score when neck=1 and legs=1 (TABLE_A[trunk-1][0][0]).
  // From the canonical Table A column [neck=1, legs=1]:
  //   trunk=1 → 1, trunk=2 → 2, trunk=3 → 2, trunk=4 → 3, trunk=5 → 4.
  const baseWithTrunk = (deg: number, twisted = false): RebaInput => ({
    ...neutral(),
    trunk: { flexionDeg: deg, twisted },
  });

  it('trunk=1 (erect 0°) → Table-A column[1,1] = 1', () => {
    const r = calculateReba(baseWithTrunk(0));
    expect(r.scoreA).toBe(1);
  });

  it('trunk=2 (1° flex, in 0-20° band) → Table-A = 2', () => {
    const r = calculateReba(baseWithTrunk(1));
    expect(r.scoreA).toBe(2);
  });

  it('trunk=3 (21° flex, in 20-60° band) → Table-A = 2', () => {
    // Trunk score 3, neck 1, legs 1 → TABLE_A[2][0][0] = 2
    const r = calculateReba(baseWithTrunk(21));
    expect(r.scoreA).toBe(2);
  });

  it('trunk=4 (61° flex, > 60°) → Table-A = 3', () => {
    // Trunk score 4, neck 1, legs 1 → TABLE_A[3][0][0] = 3
    const r = calculateReba(baseWithTrunk(61));
    expect(r.scoreA).toBe(3);
  });

  it('trunk twist adds +1 (trunk 1° → adjusted 3 → Table-A = 2)', () => {
    // Trunk base 2 (1°) + twist 1 = 3, neck 1, legs 1 → TABLE_A[2][0][0] = 2
    const r = calculateReba(baseWithTrunk(1, true));
    expect(r.scoreA).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Neck — >20° flex = 2, twist adds +1
// ─────────────────────────────────────────────────────────────────────
describe('neck score', () => {
  it('neck >20° flex (25°) → score 2 → TABLE_A[0][1][0] = 1', () => {
    // Trunk 1, neck 2, legs 1 → TABLE_A[0][1][0] = 1
    const r = calculateReba({ ...neutral(), neck: { flexionDeg: 25 } });
    expect(r.scoreA).toBe(1);
  });

  it('neck twist adds +1 (25° + twist → neck score 3 → TABLE_A[0][2][0] = 3)', () => {
    const r = calculateReba({
      ...neutral(),
      neck: { flexionDeg: 25, twisted: true },
    });
    expect(r.scoreA).toBe(3);
  });

  it('any neck extension (-5°) is treated as score 2', () => {
    // Trunk 1, neck 2, legs 1 → TABLE_A[0][1][0] = 1
    const r = calculateReba({ ...neutral(), neck: { flexionDeg: -5 } });
    expect(r.scoreA).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Legs — bilateral knee 0° = 1; unilateral knee 30° = 3
// ─────────────────────────────────────────────────────────────────────
describe('legs score', () => {
  it('bilateral support knee 0° → legs=1 → TABLE_A[0][0][0] = 1', () => {
    const r = calculateReba(neutral());
    expect(r.scoreA).toBe(1);
  });

  it('unilateral support knee 30° → legs=2+1=3 → TABLE_A[0][0][2] = 3', () => {
    const r = calculateReba({
      ...neutral(),
      legs: { bilateralSupport: false, kneeFlexionDeg: 30 },
    });
    // trunk=1, neck=1, legs=3 → TABLE_A[0][0][2] = 3
    expect(r.scoreA).toBe(3);
  });

  it('bilateral support knee 70° → legs=1+2=3 → TABLE_A[0][0][2] = 3', () => {
    const r = calculateReba({
      ...neutral(),
      legs: { bilateralSupport: true, kneeFlexionDeg: 70 },
    });
    expect(r.scoreA).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Upper-arm boundaries at 20°, 45°, 90°
// ─────────────────────────────────────────────────────────────────────
describe('upper-arm score boundaries', () => {
  // Sub-table B[upperArm-1][lowerArm=1=index 0][wrist=1=index 0]:
  //   UA=1 → 1, UA=2 → 1, UA=3 → 3, UA=4 → 4, UA=5 → 6, UA=6 → 7.
  const withUA = (deg: number, extra: Partial<RebaInput['upperArm']> = {}) => ({
    ...neutral(),
    upperArm: { flexionDeg: deg, ...extra },
  });

  it('UA 20° → score 1 → TABLE_B[0][0][0] = 1', () => {
    expect(calculateReba(withUA(20)).scoreB).toBe(1);
  });

  it('UA 45° (in 20-45° band) → score 2 → TABLE_B[1][0][0] = 1', () => {
    expect(calculateReba(withUA(45)).scoreB).toBe(1);
  });

  it('UA 90° (in 45-90° band) → score 3 → TABLE_B[2][0][0] = 3', () => {
    expect(calculateReba(withUA(90)).scoreB).toBe(3);
  });

  it('UA 91° (>90°) → score 4 → TABLE_B[3][0][0] = 4', () => {
    expect(calculateReba(withUA(91)).scoreB).toBe(4);
  });

  it('UA shoulderRaised adds +1 (20° raised → score 2 → TABLE_B[1][0][0] = 1)', () => {
    expect(calculateReba(withUA(20, { shoulderRaised: true })).scoreB).toBe(1);
  });

  it('UA supported subtracts 1, clamped ≥1 (20° supported → score 1)', () => {
    expect(calculateReba(withUA(20, { supported: true })).scoreB).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Lower-arm 60° vs 90° vs 120°
// ─────────────────────────────────────────────────────────────────────
describe('lower-arm score', () => {
  it('60° → score 1 → TABLE_B[0][0][0] = 1', () => {
    const r = calculateReba({ ...neutral(), lowerArm: { flexionDeg: 60 } });
    expect(r.scoreB).toBe(1);
  });

  it('90° → score 1 → TABLE_B[0][0][0] = 1', () => {
    const r = calculateReba({ ...neutral(), lowerArm: { flexionDeg: 90 } });
    expect(r.scoreB).toBe(1);
  });

  it('120° (>100°) → score 2 → TABLE_B[0][1][0] = 1', () => {
    // upperArm=1, lowerArm=2, wrist=1 → TABLE_B[0][1][0] = 1
    const r = calculateReba({ ...neutral(), lowerArm: { flexionDeg: 120 } });
    expect(r.scoreB).toBe(1);
  });

  it('40° (<60°) → score 2 → TABLE_B[0][1][0] = 1', () => {
    const r = calculateReba({ ...neutral(), lowerArm: { flexionDeg: 40 } });
    expect(r.scoreB).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Wrist — 16° flex → score 2; twist adds +1
// ─────────────────────────────────────────────────────────────────────
describe('wrist score', () => {
  it('wrist 16° → score 2 → TABLE_B[0][0][1] = 2', () => {
    const r = calculateReba({ ...neutral(), wrist: { flexionDeg: 16 } });
    expect(r.scoreB).toBe(2);
  });

  it('wrist 16° + twist → score 3 → TABLE_B[0][0][2] = 2', () => {
    const r = calculateReba({
      ...neutral(),
      wrist: { flexionDeg: 16, twistedOrDeviated: true },
    });
    expect(r.scoreB).toBe(2);
  });

  it('wrist -20° (extension) → score 2', () => {
    const r = calculateReba({ ...neutral(), wrist: { flexionDeg: -20 } });
    expect(r.scoreB).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. Load and shock
// ─────────────────────────────────────────────────────────────────────
describe('load adjustment', () => {
  it('load 6kg adds +1 to scoreA', () => {
    const r = calculateReba({ ...neutral(), load: { kg: 6 } });
    // Table A neutral = 1, +1 load → 2
    expect(r.scoreA).toBe(2);
  });

  it('load 12kg adds +2', () => {
    const r = calculateReba({ ...neutral(), load: { kg: 12 } });
    expect(r.scoreA).toBe(3);
  });

  it('shock adds +1 even at 0kg', () => {
    const r = calculateReba({
      ...neutral(),
      load: { kg: 0, shockOrRapid: true },
    });
    expect(r.scoreA).toBe(2);
  });

  it('load <5kg = 0', () => {
    const r = calculateReba({ ...neutral(), load: { kg: 4.99 } });
    expect(r.scoreA).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. Coupling
// ─────────────────────────────────────────────────────────────────────
describe('coupling adjustment', () => {
  it('good = 0', () => {
    expect(calculateReba(neutral()).scoreB).toBe(1);
  });
  it('fair = +1', () => {
    expect(calculateReba({ ...neutral(), coupling: 'fair' }).scoreB).toBe(2);
  });
  it('poor = +2', () => {
    expect(calculateReba({ ...neutral(), coupling: 'poor' }).scoreB).toBe(3);
  });
  it('unacceptable = +3', () => {
    expect(
      calculateReba({ ...neutral(), coupling: 'unacceptable' }).scoreB,
    ).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. Activity flags
// ─────────────────────────────────────────────────────────────────────
describe('activity score', () => {
  it('all three activity flags add +3 to final', () => {
    const r = calculateReba({
      ...neutral(),
      activity: {
        staticOver1Min: true,
        repeatedSmallRange: true,
        rapidLargeRangeChanges: true,
      },
    });
    expect(r.activityScore).toBe(3);
    expect(r.scoreC).toBe(1);
    expect(r.finalScore).toBe(4);
  });

  it('one flag adds +1', () => {
    const r = calculateReba({
      ...neutral(),
      activity: { staticOver1Min: true },
    });
    expect(r.activityScore).toBe(1);
    expect(r.finalScore).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 11. Worked example (canonical assembly worker)
// ─────────────────────────────────────────────────────────────────────
describe('worked example — assembly worker', () => {
  /*
   * INPUT:
   *   trunk 25° flex (no twist)
   *   neck 15° flex
   *   bilateral support, knee 10°
   *   upper arm 50° flex
   *   lower arm 70°
   *   wrist 10°
   *   load 4 kg
   *   coupling fair
   *   activity: static > 1 min
   *
   * HAND CALCULATION:
   *   - Trunk 25° → 20-60° band → trunk score = 3 (no twist).
   *   - Neck 15° → 0-20° band → neck score = 1 (no twist).
   *   - Legs bilateral, knee 10° → legs score = 1 (no knee adjust).
   *   - Table A[trunk=3][neck=1][legs=1] = TABLE_A[2][0][0] = 2.
   *   - Load 4 kg → 0 (under 5 kg). No shock.
   *   - scoreA = 2 + 0 = 2.
   *
   *   - Upper arm 50° → 45-90° band → UA score = 3.
   *   - Lower arm 70° → 60-100° → LA score = 1.
   *   - Wrist 10° → ≤15° → score = 1.
   *   - Table B[UA=3][LA=1][wrist=1] = TABLE_B[2][0][0] = 3.
   *   - Coupling fair → +1.
   *   - scoreB = 3 + 1 = 4.
   *
   *   - Table C[A=2][B=4] = TABLE_C[1][3] = 3.
   *   - scoreC = 3.
   *   - Activity static>1min → activityScore = 1.
   *   - finalScore = 3 + 1 = 4.
   *   - Action level: 4-7 → "medium".
   */
  it('produces scoreA=2, scoreB=4, scoreC=3, finalScore=4 (medium)', () => {
    const r = calculateReba({
      trunk: { flexionDeg: 25 },
      neck: { flexionDeg: 15 },
      legs: { bilateralSupport: true, kneeFlexionDeg: 10 },
      upperArm: { flexionDeg: 50 },
      lowerArm: { flexionDeg: 70 },
      wrist: { flexionDeg: 10 },
      load: { kg: 4 },
      coupling: 'fair',
      activity: { staticOver1Min: true },
    });
    expect(r.scoreA).toBe(2);
    expect(r.scoreB).toBe(4);
    expect(r.scoreC).toBe(3);
    expect(r.activityScore).toBe(1);
    expect(r.finalScore).toBe(4);
    expect(r.actionLevel).toBe('medium');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 12. Action-level transitions — 1, 3, 7, 10, 11
// ─────────────────────────────────────────────────────────────────────
describe('action-level transitions', () => {
  it('finalScore = 1 → negligible', () => {
    expect(calculateReba(neutral()).actionLevel).toBe('negligible');
  });

  it('finalScore = 3 → low', () => {
    /*
     * Build:
     *   trunk 25° (3), neck 15° (1), legs bilateral knee 10° (1)
     *   TABLE_A[2][0][0] = 2; load 6 kg → +1 → scoreA = 3
     *   neutral arm/wrist → TABLE_B[0][0][0] = 1; coupling good → scoreB = 1
     *   TABLE_C[2][0] = 2
     *   activity static → +1 → finalScore = 3
     */
    const r = calculateReba({
      ...neutral(),
      trunk: { flexionDeg: 25 },
      neck: { flexionDeg: 15 },
      load: { kg: 6 },
      activity: { staticOver1Min: true },
    });
    expect(r.finalScore).toBe(3);
    expect(r.actionLevel).toBe('low');
  });

  it('finalScore = 7 → medium', () => {
    /*
     * trunk 65° (4), neck 25° (2), legs unilateral knee 45° (2+1=3)
     *   TABLE_A[3][1][2] = 7; load 0 → scoreA = 7
     * UA 50° (3), LA 70° (1), wrist 0° (1) → TABLE_B[2][0][0] = 3; coupling good → scoreB = 3
     * TABLE_C[6][2] = 7
     * activity 0 → final = 7
     */
    const r = calculateReba({
      trunk: { flexionDeg: 65 },
      neck: { flexionDeg: 25 },
      legs: { bilateralSupport: false, kneeFlexionDeg: 45 },
      upperArm: { flexionDeg: 50 },
      lowerArm: { flexionDeg: 70 },
      wrist: { flexionDeg: 0 },
      load: { kg: 0 },
      coupling: 'good',
      activity: {},
    });
    expect(r.scoreA).toBe(7);
    expect(r.scoreB).toBe(3);
    expect(r.scoreC).toBe(7);
    expect(r.finalScore).toBe(7);
    expect(r.actionLevel).toBe('medium');
  });

  it('finalScore = 10 → high', () => {
    /*
     * trunk 25° (3), neck 25° (2), legs unilateral knee 45° (3)
     *   TABLE_A[2][1][2] = 6; load 6 kg → +1 → scoreA = 7
     * UA 50° (3) abducted (4), LA 70° (1), wrist 0° (1) → TABLE_B[3][0][0] = 4
     *   coupling fair (+1) → scoreB = 5
     * TABLE_C[6][4] = 9
     * activity static → +1 → final = 10
     */
    const r = calculateReba({
      trunk: { flexionDeg: 25 },
      neck: { flexionDeg: 25 },
      legs: { bilateralSupport: false, kneeFlexionDeg: 45 },
      upperArm: { flexionDeg: 50, abducted: true },
      lowerArm: { flexionDeg: 70 },
      wrist: { flexionDeg: 0 },
      load: { kg: 6 },
      coupling: 'fair',
      activity: { staticOver1Min: true },
    });
    expect(r.scoreA).toBe(7);
    expect(r.scoreB).toBe(5);
    expect(r.scoreC).toBe(9);
    expect(r.finalScore).toBe(10);
    expect(r.actionLevel).toBe('high');
  });

  it('finalScore = 11 → very_high', () => {
    /*
     * trunk 65° (4) twisted (5), neck 15° (1) twisted (2), legs unilateral knee 45° (3)
     *   TABLE_A[4][1][2] = 8; load 0 → scoreA = 8
     * UA 100° (4), LA 70° (1), wrist 20° (2) → TABLE_B[3][0][1] = 5
     *   coupling fair (+1) → scoreB = 6
     * TABLE_C[7][5] = 10
     * activity static → +1 → final = 11
     */
    const r = calculateReba({
      trunk: { flexionDeg: 65, twisted: true },
      neck: { flexionDeg: 15, twisted: true },
      legs: { bilateralSupport: false, kneeFlexionDeg: 45 },
      upperArm: { flexionDeg: 100 },
      lowerArm: { flexionDeg: 70 },
      wrist: { flexionDeg: 20 },
      load: { kg: 0 },
      coupling: 'fair',
      activity: { staticOver1Min: true },
    });
    expect(r.scoreA).toBe(8);
    expect(r.scoreB).toBe(6);
    expect(r.scoreC).toBe(10);
    expect(r.finalScore).toBe(11);
    expect(r.actionLevel).toBe('very_high');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 13. Input validation
// ─────────────────────────────────────────────────────────────────────
describe('input validation', () => {
  it('throws on null/undefined input', () => {
    expect(() => calculateReba(undefined as unknown as RebaInput)).toThrow(
      /input is required/,
    );
    expect(() => calculateReba(null as unknown as RebaInput)).toThrow(
      /input is required/,
    );
  });

  it('throws on missing required sections', () => {
    expect(() =>
      // @ts-expect-error — missing fields on purpose
      calculateReba({ trunk: { flexionDeg: 0 } }),
    ).toThrow(/required/);
  });

  it('throws on out-of-range angle (200°)', () => {
    expect(() =>
      calculateReba({ ...neutral(), trunk: { flexionDeg: 200 } }),
    ).toThrow(/out of range/);
  });

  it('throws on negative knee flexion', () => {
    expect(() =>
      calculateReba({
        ...neutral(),
        legs: { bilateralSupport: true, kneeFlexionDeg: -5 },
      }),
    ).toThrow(/non-negative/);
  });

  it('throws on negative load kg', () => {
    expect(() =>
      calculateReba({ ...neutral(), load: { kg: -1 } }),
    ).toThrow(/non-negative/);
  });

  it('throws on invalid coupling value', () => {
    expect(() =>
      calculateReba({
        ...neutral(),
        // @ts-expect-error — invalid literal on purpose
        coupling: 'mediocre',
      }),
    ).toThrow(/coupling/);
  });

  it('throws on NaN angle', () => {
    expect(() =>
      calculateReba({ ...neutral(), trunk: { flexionDeg: Number.NaN } }),
    ).toThrow(/finite/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 13b. Trunk + neck combined twist & side-bend each add +1 (up to +2)
//     per Hignett & McAtamney 2000 worksheet (twist and side-bend are
//     independent adjustments, not OR-collapsed).
// ─────────────────────────────────────────────────────────────────────
describe('twist and side-bend are independent (+1 each)', () => {
  // Pick trunk 25° + neck 25° + unilateral knee 30° so the lookup row of
  // TABLE_A is in the steep zone (no saturation) — this lets each independent
  // +1 propagate to scoreA. trunk_score: 25° flex = 3, +twist = 4, +sideBent = 5.
  // Lookups: TABLE_A[2][1][2]=6, TABLE_A[3][1][2]=7, TABLE_A[4][1][2]=8.
  it('trunk 25° twisted only (+1) → scoreA = 7; +sideBent (+1 more) → scoreA = 8', () => {
    const base: RebaInput = {
      ...neutral(),
      trunk: { flexionDeg: 25 },
      neck: { flexionDeg: 25 },
      legs: { bilateralSupport: false, kneeFlexionDeg: 30 },
    };
    const noAdj = calculateReba(base);
    const twistOnly = calculateReba({ ...base, trunk: { flexionDeg: 25, twisted: true } });
    const both = calculateReba({ ...base, trunk: { flexionDeg: 25, twisted: true, sideBent: true } });
    expect(noAdj.scoreA).toBe(6);
    expect(twistOnly.scoreA).toBe(7);
    expect(both.scoreA).toBe(8);
  });

  it('neck 25° twisted only → scoreA increment = 1; twisted+sideBent → +2 (saturating at table edge)', () => {
    const base: RebaInput = {
      ...neutral(),
      trunk: { flexionDeg: 25 },
      neck: { flexionDeg: 25 },
      legs: { bilateralSupport: false, kneeFlexionDeg: 30 },
    };
    const noAdj = calculateReba(base);
    const twistOnly = calculateReba({ ...base, neck: { flexionDeg: 25, twisted: true } });
    const both = calculateReba({ ...base, neck: { flexionDeg: 25, twisted: true, sideBent: true } });
    expect(twistOnly.scoreA).toBeGreaterThanOrEqual(noAdj.scoreA);
    expect(both.scoreA).toBeGreaterThanOrEqual(twistOnly.scoreA);
    // The two adjustments together must yield strictly more than just twist alone
    // somewhere — assert via finalScore which propagates through Table C.
    expect(both.finalScore).toBeGreaterThanOrEqual(twistOnly.finalScore);
  });
});

// ===========================================================================
// R21 — Parametric snapshot tests of TABLE_A / TABLE_B / TABLE_C (REBA)
//
// Mirror del A4 R20 sobre rula.ts. Los valores expected son verbatim del
// Hignett & McAtamney 2000 worksheet (las 3 lookup tables canónicas que
// también están reproducidas en reba.ts). Cualquier mutación que altere
// una celda individual hace fallar al menos un test parametrico.
//
// Para evitar interacción con load/coupling/activity, los inputs del
// bloque TABLE_A fijan load=0 + coupling=good ⇒ scoreA = tableA,
// scoreB = tableB. Para TABLE_C se busca un par (A, B) input tal que
// los valores de tableA y tableB lleguen al índice deseado tras sumar
// load/coupling según el caso.
// ===========================================================================

// --- Expected canonical tables (Hignett 2000 worksheet, verbatim) ---------

// TABLE_A_EXPECTED[trunk-1][neck-1][legs-1] — trunk 1-5, neck 1-3, legs 1-4
const TABLE_A_EXPECTED: readonly (readonly (readonly number[])[])[] = [
  // trunk = 1
  [
    [1, 2, 3, 4],
    [1, 2, 3, 4],
    [3, 3, 5, 6],
  ],
  // trunk = 2
  [
    [2, 3, 4, 5],
    [3, 4, 5, 6],
    [4, 5, 6, 7],
  ],
  // trunk = 3
  [
    [2, 4, 5, 6],
    [4, 5, 6, 7],
    [5, 6, 7, 8],
  ],
  // trunk = 4
  [
    [3, 5, 6, 7],
    [5, 6, 7, 8],
    [6, 7, 8, 9],
  ],
  // trunk = 5
  [
    [4, 6, 7, 8],
    [6, 7, 8, 9],
    [7, 8, 9, 9],
  ],
];

// TABLE_B_EXPECTED[upperArm-1][lowerArm-1][wrist-1] — UA 1-6, LA 1-2, wrist 1-3
const TABLE_B_EXPECTED: readonly (readonly (readonly number[])[])[] = [
  // upperArm = 1
  [
    [1, 2, 2],
    [1, 2, 3],
  ],
  // upperArm = 2
  [
    [1, 2, 3],
    [2, 3, 4],
  ],
  // upperArm = 3
  [
    [3, 4, 5],
    [4, 5, 5],
  ],
  // upperArm = 4
  [
    [4, 5, 5],
    [5, 6, 7],
  ],
  // upperArm = 5
  [
    [6, 7, 8],
    [7, 8, 8],
  ],
  // upperArm = 6
  [
    [7, 8, 8],
    [8, 9, 9],
  ],
];

// TABLE_C_EXPECTED[A-1][B-1] — A 1-12, B 1-12
const TABLE_C_EXPECTED: readonly (readonly number[])[] = [
  [1, 1, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7],
  [1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8],
  [2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 8, 8],
  [3, 4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9],
  [4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9, 9],
  [6, 6, 6, 7, 8, 8, 9, 9, 10, 10, 10, 10],
  [7, 7, 7, 8, 9, 9, 9, 10, 10, 11, 11, 11],
  [8, 8, 8, 9, 10, 10, 10, 10, 10, 11, 11, 11],
  [9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12],
  [10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 12],
  [11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12],
  [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
];

// --- Input drivers --------------------------------------------------------

/** Drive trunkScore to target (1-5). */
function driveTrunk(target: number): RebaInput['trunk'] {
  switch (target) {
    case 1: return { flexionDeg: 0 };                               // abs===0 → 1
    case 2: return { flexionDeg: 1 };                               // 0<flex<=20 → 2
    case 3: return { flexionDeg: 21 };                              // 20<flex<=60 → 3
    case 4: return { flexionDeg: 61 };                              // >60 → 4
    case 5: return { flexionDeg: 61, twisted: true };               // 4 + 1 = 5
    default: throw new Error(`driveTrunk: target ${target} out of range`);
  }
}

/** Drive neckScore to target (1-3). */
function driveNeck(target: number): RebaInput['neck'] {
  switch (target) {
    case 1: return { flexionDeg: 0 };                               // 0..20 → 1
    case 2: return { flexionDeg: 25 };                              // >20 → 2
    case 3: return { flexionDeg: 25, twisted: true };               // 2 + 1 = 3
    default: throw new Error(`driveNeck: target ${target} out of range`);
  }
}

/** Drive legsScore to target (1-4). */
function driveLegs(target: number): RebaInput['legs'] {
  switch (target) {
    case 1: return { bilateralSupport: true, kneeFlexionDeg: 0 };           // 1
    case 2: return { bilateralSupport: false, kneeFlexionDeg: 0 };          // 2
    case 3: return { bilateralSupport: false, kneeFlexionDeg: 30 };         // 2+1 = 3
    case 4: return { bilateralSupport: false, kneeFlexionDeg: 70 };         // 2+2 = 4
    default: throw new Error(`driveLegs: target ${target} out of range`);
  }
}

/** Drive upperArmScore to target (1-6). */
function driveUpperArm(target: number): RebaInput['upperArm'] {
  switch (target) {
    case 1: return { flexionDeg: 0 };                                                  // [-20,20] → 1
    case 2: return { flexionDeg: 30 };                                                 // (20,45] → 2
    case 3: return { flexionDeg: 60 };                                                 // (45,90] → 3
    case 4: return { flexionDeg: 100 };                                                // >90 → 4
    case 5: return { flexionDeg: 100, shoulderRaised: true };                          // 4+1 = 5
    case 6: return { flexionDeg: 100, shoulderRaised: true, abducted: true };          // 4+1+1 = 6
    default: throw new Error(`driveUpperArm: target ${target} out of range`);
  }
}

/** Drive lowerArmScore to target (1-2). */
function driveLowerArm(target: number): RebaInput['lowerArm'] {
  switch (target) {
    case 1: return { flexionDeg: 70 };  // 60..100 → 1
    case 2: return { flexionDeg: 50 };  // <60 → 2
    default: throw new Error(`driveLowerArm: target ${target} out of range`);
  }
}

/** Drive wristScore to target (1-3). */
function driveWrist(target: number): RebaInput['wrist'] {
  switch (target) {
    case 1: return { flexionDeg: 0 };                              // |f|<=15 → 1
    case 2: return { flexionDeg: 16 };                             // |f|>15 → 2
    case 3: return { flexionDeg: 16, twistedOrDeviated: true };    // 2+1 = 3
    default: throw new Error(`driveWrist: target ${target} out of range`);
  }
}

/**
 * Build a RebaInput pinned to (trunk, neck, legs). Group B kept neutral so
 * tableB=1 and scoreB=1, and load=0/coupling=good so scoreA = TABLE_A cell.
 */
function inputForA(trunk: number, neck: number, legs: number): RebaInput {
  return {
    trunk: driveTrunk(trunk),
    neck: driveNeck(neck),
    legs: driveLegs(legs),
    upperArm: { flexionDeg: 0 },
    lowerArm: { flexionDeg: 70 },
    wrist: { flexionDeg: 0 },
    load: { kg: 0 },
    coupling: 'good',
    activity: {},
  };
}

/**
 * Build a RebaInput pinned to (upperArm, lowerArm, wrist). Group A kept
 * neutral so tableA=1, load=0 ⇒ scoreA=1; coupling=good ⇒ scoreB = tableB.
 */
function inputForB(upperArm: number, lowerArm: number, wrist: number): RebaInput {
  return {
    trunk: { flexionDeg: 0 },
    neck: { flexionDeg: 0 },
    legs: { bilateralSupport: true, kneeFlexionDeg: 0 },
    upperArm: driveUpperArm(upperArm),
    lowerArm: driveLowerArm(lowerArm),
    wrist: driveWrist(wrist),
    load: { kg: 0 },
    coupling: 'good',
    activity: {},
  };
}

// --- TABLE_A parametric tests --------------------------------------------

const tableACells: Array<[string, RebaInput, number]> = [];
for (let trunk = 1; trunk <= 5; trunk++) {
  for (let neck = 1; neck <= 3; neck++) {
    for (let legs = 1; legs <= 4; legs++) {
      const expected = TABLE_A_EXPECTED[trunk - 1]![neck - 1]![legs - 1]!;
      tableACells.push([
        `TABLE_A[trunk=${trunk}][neck=${neck}][legs=${legs}] = ${expected}`,
        inputForA(trunk, neck, legs),
        expected,
      ]);
    }
  }
}

describe('REBA — TABLE_A canonical cell snapshots (R21)', () => {
  it.each(tableACells)('%s', (_label, input, expected) => {
    const r = calculateReba(input);
    // load=0 ⇒ scoreA === tableA
    expect(r.scoreA).toBe(expected);
  });
});

// --- TABLE_B parametric tests --------------------------------------------

const tableBCells: Array<[string, RebaInput, number]> = [];
for (let ua = 1; ua <= 6; ua++) {
  for (let la = 1; la <= 2; la++) {
    for (let wr = 1; wr <= 3; wr++) {
      const expected = TABLE_B_EXPECTED[ua - 1]![la - 1]![wr - 1]!;
      tableBCells.push([
        `TABLE_B[upperArm=${ua}][lowerArm=${la}][wrist=${wr}] = ${expected}`,
        inputForB(ua, la, wr),
        expected,
      ]);
    }
  }
}

describe('REBA — TABLE_B canonical cell snapshots (R21)', () => {
  it.each(tableBCells)('%s', (_label, input, expected) => {
    const r = calculateReba(input);
    // coupling=good ⇒ scoreB === tableB
    expect(r.scoreB).toBe(expected);
  });
});

// --- TABLE_C parametric tests --------------------------------------------
//
// TABLE_C is indexed by (scoreA, scoreB) ∈ [1..12] × [1..12]. To exercise
// cell (a, b) directly we set load=0 and coupling=good, then find a
// TABLE_A cell whose value equals a and a TABLE_B cell whose value equals b.
// scoreA range from TABLE_A is 1..9 and from load 0..3 ⇒ up to 12.
// scoreB range from TABLE_B is 1..9 and from coupling 0..3 ⇒ up to 12.
//
// For values 1..9 we can hit the cell directly via TABLE_A/B (no load/coupling).
// For values 10..12 we need to compose: TABLE_A=9 + load 1..3, or
// TABLE_B=9 + coupling 1..3 (poor=2, unacceptable=3, plus shock for load).

interface ABuild {
  trunk: number;
  neck: number;
  legs: number;
  load: RebaInput['load'];
}
interface BBuild {
  upperArm: number;
  lowerArm: number;
  wrist: number;
  coupling: RebaInput['coupling'];
}

function findATableForScoreA(target: number): ABuild {
  // First try direct (load=0, tableA = target). Range tableA: 1..9.
  if (target >= 1 && target <= 9) {
    for (let t = 1; t <= 5; t++) {
      for (let n = 1; n <= 3; n++) {
        for (let l = 1; l <= 4; l++) {
          if (TABLE_A_EXPECTED[t - 1]![n - 1]![l - 1] === target) {
            return { trunk: t, neck: n, legs: l, load: { kg: 0 } };
          }
        }
      }
    }
  }
  // 10..12 → tableA=9 + extra load. load: 1 (5-10kg), 2 (>10), +1 shock.
  // 9 + 1 (5kg) = 10; 9 + 2 (12kg) = 11; 9 + 3 (12kg + shock) = 12.
  if (target === 10) {
    return findCellWithLoad(9, { kg: 6 });
  }
  if (target === 11) {
    return findCellWithLoad(9, { kg: 12 });
  }
  if (target === 12) {
    return findCellWithLoad(9, { kg: 12, shockOrRapid: true });
  }
  throw new Error(`findATableForScoreA: target ${target} out of range`);
}

function findCellWithLoad(tableAValue: number, load: RebaInput['load']): ABuild {
  for (let t = 1; t <= 5; t++) {
    for (let n = 1; n <= 3; n++) {
      for (let l = 1; l <= 4; l++) {
        if (TABLE_A_EXPECTED[t - 1]![n - 1]![l - 1] === tableAValue) {
          return { trunk: t, neck: n, legs: l, load };
        }
      }
    }
  }
  throw new Error(`No TABLE_A cell with value ${tableAValue}`);
}

function findBTableForScoreB(target: number): BBuild {
  if (target >= 1 && target <= 9) {
    for (let u = 1; u <= 6; u++) {
      for (let la = 1; la <= 2; la++) {
        for (let w = 1; w <= 3; w++) {
          if (TABLE_B_EXPECTED[u - 1]![la - 1]![w - 1] === target) {
            return { upperArm: u, lowerArm: la, wrist: w, coupling: 'good' };
          }
        }
      }
    }
  }
  // 10..12 → tableB=9 + extra coupling. fair=1, poor=2, unacceptable=3.
  if (target === 10) {
    return findBCellWithCoupling(9, 'fair');
  }
  if (target === 11) {
    return findBCellWithCoupling(9, 'poor');
  }
  if (target === 12) {
    return findBCellWithCoupling(9, 'unacceptable');
  }
  throw new Error(`findBTableForScoreB: target ${target} out of range`);
}

function findBCellWithCoupling(tableBValue: number, coupling: RebaInput['coupling']): BBuild {
  for (let u = 1; u <= 6; u++) {
    for (let la = 1; la <= 2; la++) {
      for (let w = 1; w <= 3; w++) {
        if (TABLE_B_EXPECTED[u - 1]![la - 1]![w - 1] === tableBValue) {
          return { upperArm: u, lowerArm: la, wrist: w, coupling };
        }
      }
    }
  }
  throw new Error(`No TABLE_B cell with value ${tableBValue}`);
}

function inputForC(a: number, b: number): RebaInput {
  const aBuild = findATableForScoreA(a);
  const bBuild = findBTableForScoreB(b);
  return {
    trunk: driveTrunk(aBuild.trunk),
    neck: driveNeck(aBuild.neck),
    legs: driveLegs(aBuild.legs),
    upperArm: driveUpperArm(bBuild.upperArm),
    lowerArm: driveLowerArm(bBuild.lowerArm),
    wrist: driveWrist(bBuild.wrist),
    load: aBuild.load,
    coupling: bBuild.coupling,
    activity: {},
  };
}

const tableCCells: Array<[string, RebaInput, number, number, number]> = [];
for (let a = 1; a <= 12; a++) {
  for (let b = 1; b <= 12; b++) {
    const expected = TABLE_C_EXPECTED[a - 1]![b - 1]!;
    tableCCells.push([
      `TABLE_C[A=${a}][B=${b}] = ${expected}`,
      inputForC(a, b),
      a,
      b,
      expected,
    ]);
  }
}

describe('REBA — TABLE_C canonical cell snapshots (R21)', () => {
  // Assert scoreA, scoreB and scoreC together so any mutation in TABLE_C
  // OR in the A/B aggregation triggers a kill.
  it.each(tableCCells)('%s', (_label, input, a, b, expected) => {
    const r = calculateReba(input);
    expect(r.scoreA).toBe(a);
    expect(r.scoreB).toBe(b);
    expect(r.scoreC).toBe(expected);
  });
});

// --- Identity check: TABLE_A / TABLE_B / TABLE_C structural snapshot -----

describe('REBA — canonical table structural identity (R21)', () => {
  it('TABLE_A_EXPECTED is the canonical 5×3×4 lookup (Hignett 2000)', () => {
    expect(TABLE_A_EXPECTED).toHaveLength(5);
    for (const tr of TABLE_A_EXPECTED) {
      expect(tr).toHaveLength(3);
      for (const nk of tr) {
        expect(nk).toHaveLength(4);
      }
    }
  });
  it('TABLE_B_EXPECTED is the canonical 6×2×3 lookup', () => {
    expect(TABLE_B_EXPECTED).toHaveLength(6);
    for (const ua of TABLE_B_EXPECTED) {
      expect(ua).toHaveLength(2);
      for (const la of ua) {
        expect(la).toHaveLength(3);
      }
    }
  });
  it('TABLE_C_EXPECTED is the canonical 12×12 lookup', () => {
    expect(TABLE_C_EXPECTED).toHaveLength(12);
    for (const a of TABLE_C_EXPECTED) {
      expect(a).toHaveLength(12);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 14. Final-score is always 1..15 and result has all required fields
// ─────────────────────────────────────────────────────────────────────
describe('result invariants', () => {
  it('finalScore is an integer in [1, 15] for the worst-case input', () => {
    const r = calculateReba({
      trunk: { flexionDeg: 90, twisted: true, sideBent: true },
      neck: { flexionDeg: 60, twisted: true, sideBent: true },
      legs: { bilateralSupport: false, kneeFlexionDeg: 90 },
      upperArm: {
        flexionDeg: 120,
        shoulderRaised: true,
        abducted: true,
      },
      lowerArm: { flexionDeg: 30 },
      wrist: { flexionDeg: 30, twistedOrDeviated: true },
      load: { kg: 25, shockOrRapid: true },
      coupling: 'unacceptable',
      activity: {
        staticOver1Min: true,
        repeatedSmallRange: true,
        rapidLargeRangeChanges: true,
      },
    });
    expect(Number.isInteger(r.finalScore)).toBe(true);
    expect(r.finalScore).toBeGreaterThanOrEqual(1);
    expect(r.finalScore).toBeLessThanOrEqual(15);
    expect(r.actionLevel).toBe('very_high');
  });
});
