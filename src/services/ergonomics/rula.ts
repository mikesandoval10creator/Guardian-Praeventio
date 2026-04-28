/**
 * RULA — Rapid Upper Limb Assessment.
 *
 * Pure deterministic implementation per:
 *   McAtamney, L., & Corlett, E. N. (1993). "RULA: a survey method for the
 *   investigation of work-related upper limb disorders." Applied Ergonomics,
 *   24(2), 91–99.
 *
 * Tables A, B, C are reproduced verbatim from the original paper.
 * No I/O. No deps. No network. Replaces AI delegation in geminiBackend.ts
 * for safety-critical ergonomic scoring in Praeventio Guard.
 */

// ----- Public types --------------------------------------------------------

export interface RulaInput {
  upperArm: { flexionDeg: number; shoulderRaised?: boolean; abducted?: boolean; supported?: boolean };
  lowerArm: { flexionDeg: number; acrossMidlineOrOut?: boolean };
  wrist: { flexionDeg: number; deviated?: boolean };
  wristTwist: 'mid' | 'end';
  neck: { flexionDeg: number; inExtension?: boolean; twisted?: boolean; sideBent?: boolean };
  trunk: { flexionDeg: number; wellSupported?: boolean; twisted?: boolean; sideBent?: boolean };
  legs: { supportedAndBalanced: boolean };
  muscleUse: { staticOver1Min?: boolean; repeatedOver4Min?: boolean };
  force: { kg: number; pattern: 'intermittent' | 'static' | 'repeated' | 'shock' };
}

export interface RulaResult {
  wristArmScore: number;       // table A + muscle + force
  neckTrunkLegScore: number;   // table B + muscle + force
  finalScore: number;          // 1-7
  actionLevel: 1 | 2 | 3 | 4;  // 1=acceptable, 2=further, 3=soon, 4=now
  recommendation: string;      // short Spanish
  details: {
    upperArmScore: number; lowerArmScore: number; wristScore: number; wristTwistScore: 1 | 2;
    postureA: number; muscleA: 0 | 1; forceA: 0 | 1 | 2 | 3;
    neckScore: number; trunkScore: number; legsScore: 1 | 2;
    postureB: number; muscleB: 0 | 1; forceB: 0 | 1 | 2 | 3;
  };
}

// ----- Lookup tables (verbatim from McAtamney & Corlett 1993) -------------

/** Table A — [upperArm 1-6][lowerArm 1-3][wrist 1-4][wristTwist 1-2] */
const TABLE_A: readonly (readonly (readonly (readonly number[])[])[])[] = [
  [ // upperArm = 1
    [[1, 2], [2, 2], [2, 3], [3, 3]],
    [[2, 2], [2, 2], [3, 3], [3, 3]],
    [[2, 3], [3, 3], [3, 3], [4, 4]],
  ],
  [ // upperArm = 2
    [[2, 3], [3, 3], [3, 4], [4, 4]],
    [[3, 3], [3, 3], [3, 4], [4, 4]],
    [[3, 4], [4, 4], [4, 4], [5, 5]],
  ],
  [ // upperArm = 3
    [[3, 3], [4, 4], [4, 4], [5, 5]],
    [[3, 4], [4, 4], [4, 4], [5, 5]],
    [[4, 4], [4, 4], [4, 5], [5, 5]],
  ],
  [ // upperArm = 4
    [[4, 4], [4, 4], [4, 5], [5, 5]],
    [[4, 4], [4, 4], [4, 5], [5, 5]],
    [[4, 4], [4, 5], [5, 5], [6, 6]],
  ],
  [ // upperArm = 5
    [[5, 5], [5, 5], [5, 6], [6, 7]],
    [[5, 6], [6, 6], [6, 7], [7, 7]],
    [[6, 6], [6, 7], [7, 7], [7, 8]],
  ],
  [ // upperArm = 6
    [[7, 7], [7, 7], [7, 8], [8, 9]],
    [[8, 8], [8, 8], [8, 9], [9, 9]],
    [[9, 9], [9, 9], [9, 9], [9, 9]],
  ],
];

/** Table B — [neck 1-6][trunk 1-6][legs 1-2] */
const TABLE_B: readonly (readonly (readonly number[])[])[] = [
  [[1, 3], [2, 3], [3, 4], [5, 5], [6, 6], [7, 7]],
  [[2, 3], [2, 3], [4, 5], [5, 5], [6, 7], [7, 7]],
  [[3, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 7]],
  [[5, 5], [5, 6], [6, 7], [7, 7], [7, 7], [8, 8]],
  [[7, 7], [7, 7], [7, 8], [8, 8], [8, 8], [8, 8]],
  [[8, 8], [8, 8], [8, 8], [8, 9], [9, 9], [9, 9]],
];

/** Table C — [wristArm 1-8][neckTrunk 1-7] → final 1-7 */
const TABLE_C: readonly (readonly number[])[] = [
  [1, 2, 3, 3, 4, 5, 5],
  [2, 2, 3, 4, 4, 5, 5],
  [3, 3, 3, 4, 4, 5, 6],
  [3, 3, 3, 4, 5, 6, 6],
  [4, 4, 4, 5, 6, 7, 7],
  [4, 4, 5, 6, 6, 7, 7],
  [5, 5, 6, 6, 7, 7, 7],
  [5, 5, 6, 7, 7, 7, 7],
];

// ----- Validation ----------------------------------------------------------

const ANGLE_MIN = -180;
const ANGLE_MAX = 180;

function checkAngle(name: string, deg: number): void {
  if (!Number.isFinite(deg)) {
    throw new RangeError(`RULA: ${name} flexionDeg must be finite, got ${deg}`);
  }
  if (deg < ANGLE_MIN || deg > ANGLE_MAX) {
    throw new RangeError(`RULA: ${name} flexionDeg=${deg}° outside [${ANGLE_MIN}, ${ANGLE_MAX}]`);
  }
}

function validate(input: RulaInput): void {
  checkAngle('upperArm', input.upperArm.flexionDeg);
  checkAngle('lowerArm', input.lowerArm.flexionDeg);
  checkAngle('wrist', input.wrist.flexionDeg);
  checkAngle('neck', input.neck.flexionDeg);
  checkAngle('trunk', input.trunk.flexionDeg);
  if (!Number.isFinite(input.force.kg) || input.force.kg < 0) {
    throw new RangeError(`RULA: force.kg must be finite ≥ 0, got ${input.force.kg}`);
  }
}

// ----- Sub-scores: Group A -------------------------------------------------

function scoreUpperArm(ua: RulaInput['upperArm']): number {
  const f = ua.flexionDeg;
  let s: number;
  if (f >= -20 && f <= 20) s = 1;          // 20° ext to 20° flex
  else if (f < -20) s = 2;                 // > 20° extension
  else if (f <= 45) s = 2;                 // 20-45° flex
  else if (f <= 90) s = 3;                 // 45-90° flex
  else s = 4;                              // > 90° flex
  if (ua.shoulderRaised) s += 1;
  if (ua.abducted) s += 1;
  if (ua.supported) s -= 1;
  return Math.max(1, s);
}

function scoreLowerArm(la: RulaInput['lowerArm']): number {
  const f = la.flexionDeg;
  let s = f >= 60 && f <= 100 ? 1 : 2;     // <60 or >100 → 2
  if (la.acrossMidlineOrOut) s += 1;
  return Math.max(1, s);
}

function scoreWrist(w: RulaInput['wrist']): number {
  const a = Math.abs(w.flexionDeg);
  let s: number;
  if (a === 0) s = 1;                      // strict neutral
  else if (a <= 15) s = 2;
  else s = 3;
  if (w.deviated) s += 1;
  return Math.max(1, s);
}

function scoreWristTwist(t: RulaInput['wristTwist']): 1 | 2 {
  return t === 'end' ? 2 : 1;
}

// ----- Sub-scores: Group B -------------------------------------------------

function scoreNeck(n: RulaInput['neck']): number {
  let s: number;
  if (n.inExtension) s = 4;
  else {
    const f = n.flexionDeg;
    if (f < 0) s = 4;                      // negative = extension
    else if (f <= 10) s = 1;
    else if (f <= 20) s = 2;
    else s = 3;
  }
  if (n.twisted) s += 1;
  if (n.sideBent) s += 1;
  return Math.max(1, s);
}

function scoreTrunk(t: RulaInput['trunk']): number {
  const f = t.flexionDeg;
  let s: number;
  if (f <= 0 && t.wellSupported) s = 1;    // seated, well supported, hips/trunk >90°
  else if (f <= 20) s = 2;
  else if (f <= 60) s = 3;
  else s = 4;
  if (t.twisted) s += 1;
  if (t.sideBent) s += 1;
  return Math.max(1, s);
}

function scoreLegs(l: RulaInput['legs']): 1 | 2 {
  return l.supportedAndBalanced ? 1 : 2;
}

// ----- Muscle / Force ------------------------------------------------------

function muscleUseScore(m: RulaInput['muscleUse']): 0 | 1 {
  return m.staticOver1Min || m.repeatedOver4Min ? 1 : 0;
}

function forceScore(f: RulaInput['force']): 0 | 1 | 2 | 3 {
  const { kg, pattern } = f;
  if (pattern === 'shock' || kg > 10) return 3;
  if (kg < 2) return pattern === 'intermittent' ? 0 : 1;
  // 2 ≤ kg ≤ 10
  if (pattern === 'static' || pattern === 'repeated') return 2;
  return 1;                                // intermittent 2-10 kg
}

// ----- Table lookups -------------------------------------------------------

function lookupTableA(ua: number, la: number, wr: number, wt: 1 | 2): number {
  const u = Math.min(ua, 6), l = Math.min(la, 3), w = Math.min(wr, 4);
  return TABLE_A[u - 1]![l - 1]![w - 1]![wt - 1]!;
}

function lookupTableB(neck: number, trunk: number, legs: 1 | 2): number {
  const n = Math.min(neck, 6), t = Math.min(trunk, 6);
  return TABLE_B[n - 1]![t - 1]![legs - 1]!;
}

function lookupTableC(wristArm: number, neckTrunk: number): number {
  const wa = Math.min(Math.max(wristArm, 1), 8);
  const nt = Math.min(Math.max(neckTrunk, 1), 7);
  return TABLE_C[wa - 1]![nt - 1]!;
}

// ----- Action level + recommendation ---------------------------------------

function actionLevelFor(final: number): 1 | 2 | 3 | 4 {
  if (final <= 2) return 1;
  if (final <= 4) return 2;
  if (final <= 6) return 3;
  return 4;
}

function recommendationFor(level: 1 | 2 | 3 | 4): string {
  switch (level) {
    case 1: return 'Postura aceptable si no se mantiene ni se repite por largos periodos.';
    case 2: return 'Se requiere mayor investigación; podrían necesitarse cambios.';
    case 3: return 'Investigar y aplicar cambios pronto.';
    case 4: return 'Investigar y aplicar cambios de inmediato.';
  }
}

// ----- Public entry point --------------------------------------------------

export function calculateRula(input: RulaInput): RulaResult {
  validate(input);

  const upperArmScore = scoreUpperArm(input.upperArm);
  const lowerArmScore = scoreLowerArm(input.lowerArm);
  const wristScore = scoreWrist(input.wrist);
  const wristTwistScore = scoreWristTwist(input.wristTwist);
  const postureA = lookupTableA(upperArmScore, lowerArmScore, wristScore, wristTwistScore);

  const muscleA = muscleUseScore(input.muscleUse);
  const forceA = forceScore(input.force);
  const wristArmScore = postureA + muscleA + forceA;

  const neckScore = scoreNeck(input.neck);
  const trunkScore = scoreTrunk(input.trunk);
  const legsScore = scoreLegs(input.legs);
  const postureB = lookupTableB(neckScore, trunkScore, legsScore);

  // The paper applies the same muscle/force criteria to Group B.
  const muscleB = muscleA;
  const forceB = forceA;
  const neckTrunkLegScore = postureB + muscleB + forceB;

  const finalScore = lookupTableC(wristArmScore, neckTrunkLegScore);
  const actionLevel = actionLevelFor(finalScore);

  return {
    wristArmScore, neckTrunkLegScore, finalScore, actionLevel,
    recommendation: recommendationFor(actionLevel),
    details: {
      upperArmScore, lowerArmScore, wristScore, wristTwistScore,
      postureA, muscleA, forceA,
      neckScore, trunkScore, legsScore,
      postureB, muscleB, forceB,
    },
  };
}
