import { describe, it, expect } from 'vitest';
import { calculateRula, type RulaInput } from './rula';

const baseInput = (): RulaInput => ({
  upperArm: { flexionDeg: 0 },
  lowerArm: { flexionDeg: 80 },
  wrist: { flexionDeg: 0 },
  wristTwist: 'mid',
  neck: { flexionDeg: 5 },
  trunk: { flexionDeg: 0, wellSupported: true },
  legs: { supportedAndBalanced: true },
  muscleUse: {},
  force: { kg: 0.5, pattern: 'intermittent' },
});

describe('RULA — neutral seated baseline (test 1)', () => {
  it('neutral seated posture yields acceptable score (1-2)', () => {
    const r = calculateRula(baseInput());
    expect(r.finalScore).toBeGreaterThanOrEqual(1);
    expect(r.finalScore).toBeLessThanOrEqual(2);
    expect(r.actionLevel).toBe(1);
    expect(r.recommendation).toMatch(/aceptable/i);
  });
});

describe('RULA — upper arm boundaries (test 2)', () => {
  it('20° flex → upperArmScore = 1', () => {
    const r = calculateRula({ ...baseInput(), upperArm: { flexionDeg: 20 } });
    expect(r.details.upperArmScore).toBe(1);
  });
  it('21° flex → upperArmScore = 2', () => {
    const r = calculateRula({ ...baseInput(), upperArm: { flexionDeg: 21 } });
    expect(r.details.upperArmScore).toBe(2);
  });
  it('45° flex → upperArmScore = 2', () => {
    const r = calculateRula({ ...baseInput(), upperArm: { flexionDeg: 45 } });
    expect(r.details.upperArmScore).toBe(2);
  });
  it('46° flex → upperArmScore = 3', () => {
    const r = calculateRula({ ...baseInput(), upperArm: { flexionDeg: 46 } });
    expect(r.details.upperArmScore).toBe(3);
  });
  it('90° flex → upperArmScore = 3', () => {
    const r = calculateRula({ ...baseInput(), upperArm: { flexionDeg: 90 } });
    expect(r.details.upperArmScore).toBe(3);
  });
  it('91° flex → upperArmScore = 4', () => {
    const r = calculateRula({ ...baseInput(), upperArm: { flexionDeg: 91 } });
    expect(r.details.upperArmScore).toBe(4);
  });
  it('-25° (extension >20°) → upperArmScore = 2', () => {
    const r = calculateRula({ ...baseInput(), upperArm: { flexionDeg: -25 } });
    expect(r.details.upperArmScore).toBe(2);
  });
  it('-20° (extension boundary) → upperArmScore = 1', () => {
    const r = calculateRula({ ...baseInput(), upperArm: { flexionDeg: -20 } });
    expect(r.details.upperArmScore).toBe(1);
  });
  it('shoulder raised adds +1', () => {
    const r = calculateRula({
      ...baseInput(),
      upperArm: { flexionDeg: 30, shoulderRaised: true },
    });
    expect(r.details.upperArmScore).toBe(3);
  });
  it('arm supported subtracts 1', () => {
    const r = calculateRula({
      ...baseInput(),
      upperArm: { flexionDeg: 30, supported: true },
    });
    expect(r.details.upperArmScore).toBe(1);
  });
});

describe('RULA — lower arm flexion (test 3)', () => {
  it('50° → lowerArmScore = 2 (<60°)', () => {
    const r = calculateRula({ ...baseInput(), lowerArm: { flexionDeg: 50 } });
    expect(r.details.lowerArmScore).toBe(2);
  });
  it('80° → lowerArmScore = 1 (60-100°)', () => {
    const r = calculateRula({ ...baseInput(), lowerArm: { flexionDeg: 80 } });
    expect(r.details.lowerArmScore).toBe(1);
  });
  it('110° → lowerArmScore = 2 (>100°)', () => {
    const r = calculateRula({ ...baseInput(), lowerArm: { flexionDeg: 110 } });
    expect(r.details.lowerArmScore).toBe(2);
  });
  it('arm across midline adds +1', () => {
    const r = calculateRula({
      ...baseInput(),
      lowerArm: { flexionDeg: 80, acrossMidlineOrOut: true },
    });
    expect(r.details.lowerArmScore).toBe(2);
  });
});

describe('RULA — wrist (test 4)', () => {
  it('0° → wristScore = 1', () => {
    const r = calculateRula({ ...baseInput(), wrist: { flexionDeg: 0 } });
    expect(r.details.wristScore).toBe(1);
  });
  it('5° → wristScore = 2', () => {
    const r = calculateRula({ ...baseInput(), wrist: { flexionDeg: 5 } });
    expect(r.details.wristScore).toBe(2);
  });
  it('20° → wristScore = 3', () => {
    const r = calculateRula({ ...baseInput(), wrist: { flexionDeg: 20 } });
    expect(r.details.wristScore).toBe(3);
  });
  it('deviated adds +1', () => {
    const r = calculateRula({
      ...baseInput(),
      wrist: { flexionDeg: 5, deviated: true },
    });
    expect(r.details.wristScore).toBe(3);
  });
});

describe('RULA — wrist twist (test 5)', () => {
  it("'end' yields 2 not 1", () => {
    const mid = calculateRula({ ...baseInput(), wristTwist: 'mid' });
    const end = calculateRula({ ...baseInput(), wristTwist: 'end' });
    expect(mid.details.wristTwistScore).toBe(1);
    expect(end.details.wristTwistScore).toBe(2);
    // End-range twist may bump table-A score depending on cell.
    expect(end.details.postureA).toBeGreaterThanOrEqual(mid.details.postureA);
  });
});

describe('RULA — muscle use (test 6)', () => {
  it('static >1 min adds +1 to wristArmScore (and neckTrunkLegScore)', () => {
    const off = calculateRula(baseInput());
    const on = calculateRula({
      ...baseInput(),
      muscleUse: { staticOver1Min: true },
    });
    expect(on.wristArmScore).toBe(off.wristArmScore + 1);
    expect(on.neckTrunkLegScore).toBe(off.neckTrunkLegScore + 1);
    expect(on.details.muscleA).toBe(1);
  });
  it('repeated >4/min adds +1', () => {
    const r = calculateRula({
      ...baseInput(),
      muscleUse: { repeatedOver4Min: true },
    });
    expect(r.details.muscleA).toBe(1);
  });
});

describe('RULA — force/load (test 7)', () => {
  it('12 kg static → +3 force component', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 12, pattern: 'static' },
    });
    expect(r.details.forceA).toBe(3);
    expect(r.details.forceB).toBe(3);
  });
  it('shock pattern → +3 regardless of kg', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 0.1, pattern: 'shock' },
    });
    expect(r.details.forceA).toBe(3);
  });
  it('5 kg intermittent → +1', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 5, pattern: 'intermittent' },
    });
    expect(r.details.forceA).toBe(1);
  });
  it('5 kg static → +2', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 5, pattern: 'static' },
    });
    expect(r.details.forceA).toBe(2);
  });
  it('<2 kg intermittent → 0', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 1, pattern: 'intermittent' },
    });
    expect(r.details.forceA).toBe(0);
  });
});

describe('RULA — neck inExtension (test 8)', () => {
  it('inExtension is treated as score 4', () => {
    const r = calculateRula({
      ...baseInput(),
      neck: { flexionDeg: 0, inExtension: true },
    });
    expect(r.details.neckScore).toBe(4);
  });
});

describe('RULA — trunk twist (test 9)', () => {
  it('trunk twist adds +1', () => {
    const off = calculateRula({
      ...baseInput(),
      trunk: { flexionDeg: 10 },
    });
    const on = calculateRula({
      ...baseInput(),
      trunk: { flexionDeg: 10, twisted: true },
    });
    expect(on.details.trunkScore).toBe(off.details.trunkScore + 1);
  });
});

describe('RULA — legs (test 10)', () => {
  it('unsupported legs → 2', () => {
    const r = calculateRula({
      ...baseInput(),
      legs: { supportedAndBalanced: false },
    });
    expect(r.details.legsScore).toBe(2);
  });
  it('supported and balanced → 1', () => {
    const r = calculateRula(baseInput());
    expect(r.details.legsScore).toBe(1);
  });
});

describe('RULA — worked example: data-entry operator (test 11)', () => {
  // Hand calc:
  //  upperArm 30° → 2
  //  lowerArm 90° → 1
  //  wrist 10° flex deviated → 2 + 1 = 3
  //  twist mid → 1
  //  TableA[2,1,3,1] = 3 → postureA=3
  //  muscleA = +1 (static>1min); forceA = 0 (1 kg intermittent)
  //  wristArmScore = 4
  //  neck 15° → 2
  //  trunk 5° flex (wellSupported but flex>0) → 2
  //  legs supported → 1
  //  TableB[2,2,1] = 2 → postureB=2
  //  muscleB=+1, forceB=0
  //  neckTrunkLegScore = 3
  //  TableC[4,3] = 3 → finalScore = 3
  it('data-entry operator → finalScore 3, action 2', () => {
    const r = calculateRula({
      upperArm: { flexionDeg: 30 },
      lowerArm: { flexionDeg: 90 },
      wrist: { flexionDeg: 10, deviated: true },
      wristTwist: 'mid',
      neck: { flexionDeg: 15 },
      trunk: { flexionDeg: 5, wellSupported: true },
      legs: { supportedAndBalanced: true },
      muscleUse: { staticOver1Min: true },
      force: { kg: 1, pattern: 'intermittent' },
    });
    expect(r.details.upperArmScore).toBe(2);
    expect(r.details.lowerArmScore).toBe(1);
    expect(r.details.wristScore).toBe(3);
    expect(r.details.wristTwistScore).toBe(1);
    expect(r.details.postureA).toBe(3);
    expect(r.details.muscleA).toBe(1);
    expect(r.details.forceA).toBe(0);
    expect(r.wristArmScore).toBe(4);
    expect(r.details.neckScore).toBe(2);
    expect(r.details.trunkScore).toBe(2);
    expect(r.details.legsScore).toBe(1);
    expect(r.details.postureB).toBe(2);
    expect(r.neckTrunkLegScore).toBe(3);
    expect(r.finalScore).toBe(3);
    expect(r.actionLevel).toBe(2);
  });
});

describe('RULA — worked example: welder overhead (test 12)', () => {
  // Hand calc:
  //  upperArm 110° + shoulderRaised → 4 + 1 = 5
  //  lowerArm 50° → 2
  //  wrist 20° → 3
  //  wristTwist end → 2
  //  TableA[5,2,3,2] = 7
  //  muscleA = +1 (repeated>4/min); forceA = +1 (7kg intermittent)
  //  wristArmScore = 9 → cap 8
  //  neck 25° → 3 + twisted → 4
  //  trunk 30° → 3
  //  legs unsupported → 2
  //  TableB[4,3,2] = 7
  //  muscleB=+1; forceB=+1
  //  neckTrunkLegScore = 9 → cap 7
  //  TableC[8,7] = 7
  it('welder overhead → finalScore ≥ 6 (in fact 7) and action 4', () => {
    const r = calculateRula({
      upperArm: { flexionDeg: 110, shoulderRaised: true },
      lowerArm: { flexionDeg: 50 },
      wrist: { flexionDeg: 20 },
      wristTwist: 'end',
      neck: { flexionDeg: 25, twisted: true },
      trunk: { flexionDeg: 30 },
      legs: { supportedAndBalanced: false },
      muscleUse: { repeatedOver4Min: true },
      force: { kg: 7, pattern: 'intermittent' },
    });
    expect(r.details.upperArmScore).toBe(5);
    expect(r.details.lowerArmScore).toBe(2);
    expect(r.details.wristScore).toBe(3);
    expect(r.details.wristTwistScore).toBe(2);
    expect(r.details.postureA).toBe(7);
    expect(r.details.neckScore).toBe(4);
    expect(r.details.trunkScore).toBe(3);
    expect(r.details.legsScore).toBe(2);
    expect(r.details.postureB).toBe(7);
    expect(r.finalScore).toBeGreaterThanOrEqual(6);
    expect(r.finalScore).toBe(7);
    expect(r.actionLevel).toBe(4);
  });
});

describe('RULA — action-level transitions (test 13)', () => {
  it('finalScore 1-2 → action 1 (acceptable)', () => {
    const r = calculateRula(baseInput());
    expect(r.actionLevel).toBe(1);
    expect(r.recommendation).toMatch(/aceptable/i);
  });
  it('finalScore 3-4 → action 2 (further investigation)', () => {
    const r = calculateRula({
      ...baseInput(),
      upperArm: { flexionDeg: 30 },
      wrist: { flexionDeg: 10, deviated: true },
      muscleUse: { staticOver1Min: true },
    });
    expect(r.finalScore).toBeGreaterThanOrEqual(3);
    expect(r.finalScore).toBeLessThanOrEqual(4);
    expect(r.actionLevel).toBe(2);
  });
  it('finalScore 5-6 → action 3 (soon)', () => {
    const r = calculateRula({
      upperArm: { flexionDeg: 60 },
      lowerArm: { flexionDeg: 50 },
      wrist: { flexionDeg: 16 },
      wristTwist: 'mid',
      neck: { flexionDeg: 25 },
      trunk: { flexionDeg: 25 },
      legs: { supportedAndBalanced: true },
      muscleUse: {},
      force: { kg: 3, pattern: 'intermittent' },
    });
    expect(r.finalScore).toBeGreaterThanOrEqual(5);
    expect(r.finalScore).toBeLessThanOrEqual(6);
    expect(r.actionLevel).toBe(3);
  });
  it('finalScore 7 → action 4 (now)', () => {
    const r = calculateRula({
      upperArm: { flexionDeg: 110, shoulderRaised: true, abducted: true },
      lowerArm: { flexionDeg: 50, acrossMidlineOrOut: true },
      wrist: { flexionDeg: 25, deviated: true },
      wristTwist: 'end',
      neck: { flexionDeg: 30, twisted: true, sideBent: true },
      trunk: { flexionDeg: 70, twisted: true },
      legs: { supportedAndBalanced: false },
      muscleUse: { staticOver1Min: true, repeatedOver4Min: true },
      force: { kg: 15, pattern: 'shock' },
    });
    expect(r.finalScore).toBe(7);
    expect(r.actionLevel).toBe(4);
    expect(r.recommendation).toMatch(/inmediato/i);
  });
});

describe('RULA — input validation (test 14)', () => {
  it('upperArm angle 200° throws RangeError', () => {
    expect(() =>
      calculateRula({ ...baseInput(), upperArm: { flexionDeg: 200 } }),
    ).toThrow(RangeError);
  });
  it('wrist angle -300° throws RangeError', () => {
    expect(() =>
      calculateRula({ ...baseInput(), wrist: { flexionDeg: -300 } }),
    ).toThrow(RangeError);
  });
  it('non-finite angle throws', () => {
    expect(() =>
      calculateRula({ ...baseInput(), neck: { flexionDeg: Number.NaN } }),
    ).toThrow(RangeError);
  });
  it('negative kg throws', () => {
    expect(() =>
      calculateRula({
        ...baseInput(),
        force: { kg: -1, pattern: 'intermittent' },
      }),
    ).toThrow(RangeError);
  });
  it('non-finite kg throws', () => {
    expect(() =>
      calculateRula({
        ...baseInput(),
        force: { kg: Number.POSITIVE_INFINITY, pattern: 'intermittent' },
      }),
    ).toThrow(RangeError);
  });
});

describe('RULA — angle boundary mutations (test 15)', () => {
  it('upperArm exactly ANGLE_MAX (180°) is accepted (no throw)', () => {
    expect(() =>
      calculateRula({ ...baseInput(), upperArm: { flexionDeg: 180 } }),
    ).not.toThrow();
  });
  it('upperArm exactly ANGLE_MIN (-180°) is accepted (no throw)', () => {
    expect(() =>
      calculateRula({ ...baseInput(), upperArm: { flexionDeg: -180 } }),
    ).not.toThrow();
  });
  it('upperArm just above ANGLE_MAX (180.0001°) throws RangeError', () => {
    expect(() =>
      calculateRula({ ...baseInput(), upperArm: { flexionDeg: 180.0001 } }),
    ).toThrow(RangeError);
  });
  it('upperArm just below ANGLE_MIN (-180.0001°) throws RangeError', () => {
    expect(() =>
      calculateRula({ ...baseInput(), upperArm: { flexionDeg: -180.0001 } }),
    ).toThrow(RangeError);
  });
  it('error message names the offending segment ("upperArm")', () => {
    expect(() =>
      calculateRula({ ...baseInput(), upperArm: { flexionDeg: 200 } }),
    ).toThrow(/upperArm/);
  });
  it('error message names the offending segment ("lowerArm")', () => {
    expect(() =>
      calculateRula({ ...baseInput(), lowerArm: { flexionDeg: 200 } }),
    ).toThrow(/lowerArm/);
  });
  it('error message names the offending segment ("wrist")', () => {
    expect(() =>
      calculateRula({ ...baseInput(), wrist: { flexionDeg: -300 } }),
    ).toThrow(/wrist/);
  });
  it('error message names the offending segment ("neck")', () => {
    expect(() =>
      calculateRula({ ...baseInput(), neck: { flexionDeg: 300 } }),
    ).toThrow(/neck/);
  });
  it('error message names the offending segment ("trunk")', () => {
    expect(() =>
      calculateRula({ ...baseInput(), trunk: { flexionDeg: 300 } }),
    ).toThrow(/trunk/);
  });
  it('non-finite angle error mentions the offending value', () => {
    expect(() =>
      calculateRula({ ...baseInput(), neck: { flexionDeg: Number.NaN } }),
    ).toThrow(/finite/);
  });
});

describe('RULA — kg=0 and lower-arm boundary mutations (test 16)', () => {
  it('force.kg = 0 exact does not throw (>= 0 boundary)', () => {
    expect(() =>
      calculateRula({
        ...baseInput(),
        force: { kg: 0, pattern: 'intermittent' },
      }),
    ).not.toThrow();
  });
  it('force.kg = 0 intermittent → forceA = 0 (boundary kg<2 path)', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 0, pattern: 'intermittent' },
    });
    expect(r.details.forceA).toBe(0);
  });
  it('force.kg slightly negative (-0.0001) throws', () => {
    expect(() =>
      calculateRula({
        ...baseInput(),
        force: { kg: -0.0001, pattern: 'intermittent' },
      }),
    ).toThrow(RangeError);
  });
  it('lowerArm exactly 60° → score 1 (>=60 boundary)', () => {
    const r = calculateRula({ ...baseInput(), lowerArm: { flexionDeg: 60 } });
    expect(r.details.lowerArmScore).toBe(1);
  });
  it('lowerArm exactly 100° → score 1 (<=100 boundary)', () => {
    const r = calculateRula({ ...baseInput(), lowerArm: { flexionDeg: 100 } });
    expect(r.details.lowerArmScore).toBe(1);
  });
  it('lowerArm 59° → score 2 (just below window)', () => {
    const r = calculateRula({ ...baseInput(), lowerArm: { flexionDeg: 59 } });
    expect(r.details.lowerArmScore).toBe(2);
  });
  it('lowerArm 101° → score 2 (just above window)', () => {
    const r = calculateRula({ ...baseInput(), lowerArm: { flexionDeg: 101 } });
    expect(r.details.lowerArmScore).toBe(2);
  });
  it('wrist exactly 15° → score 2 (<=15 boundary)', () => {
    const r = calculateRula({ ...baseInput(), wrist: { flexionDeg: 15 } });
    expect(r.details.wristScore).toBe(2);
  });
  it('wrist 16° → score 3 (>15)', () => {
    const r = calculateRula({ ...baseInput(), wrist: { flexionDeg: 16 } });
    expect(r.details.wristScore).toBe(3);
  });
  it('wrist -15° (negative) → score 2 (abs ≤15 boundary)', () => {
    const r = calculateRula({ ...baseInput(), wrist: { flexionDeg: -15 } });
    expect(r.details.wristScore).toBe(2);
  });
  it('neck exactly 10° → score 1 (<=10 boundary)', () => {
    const r = calculateRula({ ...baseInput(), neck: { flexionDeg: 10 } });
    expect(r.details.neckScore).toBe(1);
  });
  it('neck 11° → score 2 (>10)', () => {
    const r = calculateRula({ ...baseInput(), neck: { flexionDeg: 11 } });
    expect(r.details.neckScore).toBe(2);
  });
  it('neck exactly 20° → score 2 (<=20 boundary)', () => {
    const r = calculateRula({ ...baseInput(), neck: { flexionDeg: 20 } });
    expect(r.details.neckScore).toBe(2);
  });
  it('neck 21° → score 3', () => {
    const r = calculateRula({ ...baseInput(), neck: { flexionDeg: 21 } });
    expect(r.details.neckScore).toBe(3);
  });
  it('neck negative flexion (extension via angle) → score 4', () => {
    const r = calculateRula({ ...baseInput(), neck: { flexionDeg: -5 } });
    expect(r.details.neckScore).toBe(4);
  });
  it('trunk exactly 20° → score 2', () => {
    const r = calculateRula({ ...baseInput(), trunk: { flexionDeg: 20 } });
    expect(r.details.trunkScore).toBe(2);
  });
  it('trunk 21° → score 3', () => {
    const r = calculateRula({ ...baseInput(), trunk: { flexionDeg: 21 } });
    expect(r.details.trunkScore).toBe(3);
  });
  it('trunk exactly 60° → score 3', () => {
    const r = calculateRula({ ...baseInput(), trunk: { flexionDeg: 60 } });
    expect(r.details.trunkScore).toBe(3);
  });
  it('trunk 61° → score 4', () => {
    const r = calculateRula({ ...baseInput(), trunk: { flexionDeg: 61 } });
    expect(r.details.trunkScore).toBe(4);
  });
  it('force.kg exactly 2 with intermittent → +1 (not 0)', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 2, pattern: 'intermittent' },
    });
    expect(r.details.forceA).toBe(1);
  });
  it('force.kg exactly 10 with intermittent → +1 (not +3)', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 10, pattern: 'intermittent' },
    });
    expect(r.details.forceA).toBe(1);
  });
  it('force.kg = 10.0001 with intermittent → +3 (boundary >10)', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 10.0001, pattern: 'intermittent' },
    });
    expect(r.details.forceA).toBe(3);
  });
  it('force.kg = 1.999 with static → +1 (<2 path)', () => {
    const r = calculateRula({
      ...baseInput(),
      force: { kg: 1.999, pattern: 'static' },
    });
    expect(r.details.forceA).toBe(1);
  });
});
