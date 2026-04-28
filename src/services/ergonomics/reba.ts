/**
 * REBA — Rapid Entire Body Assessment (deterministic backend).
 *
 * Reference: Hignett, S., & McAtamney, L. (2000). Rapid entire body
 * assessment (REBA). Applied Ergonomics, 31(2), 201-205.
 *
 * Tables A, B and C below are the canonical lookup matrices published
 * with the REBA worksheet. They are NOT inventions: any standard REBA
 * worksheet (e.g. ergo-plus, OSHA, the original paper) lists the same
 * values. The ranges are:
 *   - Table A: trunk 1..5, neck 1..3, legs 1..4 → 1..9
 *   - Table B: upperArm 1..6, lowerArm 1..2, wrist 1..3 → 1..9
 *   - Table C: A 1..12, B 1..12 → 1..12
 *
 * After Table A we add the load score (0..3); after Table B we add the
 * coupling score (0..3). The combined Table C lookup is then adjusted by
 * the activity score (0..3) to produce the final REBA score (1..15).
 */

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export interface RebaInput {
  trunk: { flexionDeg: number; twisted?: boolean; sideBent?: boolean };
  neck: { flexionDeg: number; twisted?: boolean; sideBent?: boolean };
  legs: { bilateralSupport: boolean; kneeFlexionDeg: number };
  upperArm: {
    flexionDeg: number;
    shoulderRaised?: boolean;
    abducted?: boolean;
    supported?: boolean;
  };
  lowerArm: { flexionDeg: number };
  wrist: { flexionDeg: number; twistedOrDeviated?: boolean };
  load: { kg: number; shockOrRapid?: boolean };
  coupling: 'good' | 'fair' | 'poor' | 'unacceptable';
  activity: {
    staticOver1Min?: boolean;
    repeatedSmallRange?: boolean;
    rapidLargeRangeChanges?: boolean;
  };
}

export interface RebaResult {
  scoreA: number;
  scoreB: number;
  scoreC: number;
  activityScore: number;
  finalScore: number;
  actionLevel: 'negligible' | 'low' | 'medium' | 'high' | 'very_high';
  recommendation: string;
}

// ─────────────────────────────────────────────────────────────────────
// Tables (canonical REBA worksheet values)
// ─────────────────────────────────────────────────────────────────────

/**
 * Table A — trunk × neck × legs.
 *   index: TABLE_A[trunk-1][neck-1][legs-1]
 *   shape: 5 × 3 × 4
 */
const TABLE_A: readonly (readonly (readonly number[])[])[] = [
  // trunk = 1
  [
    [1, 2, 3, 4], // neck=1
    [1, 2, 3, 4], // neck=2
    [3, 3, 5, 6], // neck=3
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

/**
 * Table B — upperArm × lowerArm × wrist.
 *   index: TABLE_B[upperArm-1][lowerArm-1][wrist-1]
 *   shape: 6 × 2 × 3
 */
const TABLE_B: readonly (readonly (readonly number[])[])[] = [
  // upperArm = 1
  [
    [1, 2, 2], // lowerArm=1
    [1, 2, 3], // lowerArm=2
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

/**
 * Table C — final lookup (clamped A 1..12 × B 1..12).
 *   index: TABLE_C[A-1][B-1]
 *   shape: 12 × 12
 */
const TABLE_C: readonly (readonly number[])[] = [
  /* A=1  */ [1, 1, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7],
  /* A=2  */ [1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8],
  /* A=3  */ [2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 8, 8],
  /* A=4  */ [3, 4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9],
  /* A=5  */ [4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9, 9],
  /* A=6  */ [6, 6, 6, 7, 8, 8, 9, 9, 10, 10, 10, 10],
  /* A=7  */ [7, 7, 7, 8, 9, 9, 9, 10, 10, 11, 11, 11],
  /* A=8  */ [8, 8, 8, 9, 10, 10, 10, 10, 10, 11, 11, 11],
  /* A=9  */ [9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12],
  /* A=10 */ [10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 12],
  /* A=11 */ [11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12],
  /* A=12 */ [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
];

// ─────────────────────────────────────────────────────────────────────
// Sub-score helpers (each returns the raw 1..N score per REBA worksheet)
// ─────────────────────────────────────────────────────────────────────

/** Trunk: 1=erect, 2=0-20° flex/ext, 3=20-60° flex or >20° ext, 4=>60° flex.
 *  Adjustments: +1 if twisted, +1 if side-bent (independent — up to +2,
 *  per Hignett & McAtamney 2000 worksheet, Step 1 figure). */
function trunkScore(t: RebaInput['trunk']): number {
  const flex = t.flexionDeg;
  const abs = Math.abs(flex);
  let base: number;
  if (abs === 0) base = 1;
  else if (flex >= 0 && flex <= 20) base = 2;
  else if (flex < 0 && abs <= 20) base = 2;
  else if (flex > 20 && flex <= 60) base = 3;
  else if (flex < -20) base = 3; // >20° extension
  else base = 4; // > 60° flexion
  if (t.twisted) base += 1;
  if (t.sideBent) base += 1;
  return base;
}

/** Neck: 1=0-20° flex, 2=>20° flex OR any extension.
 *  +1 if twisted, +1 if side-bent (independent — up to +2, per
 *  Hignett & McAtamney 2000 worksheet, Step 2 figure). */
function neckScore(n: RebaInput['neck']): number {
  const flex = n.flexionDeg;
  let base: number;
  if (flex >= 0 && flex <= 20) base = 1;
  else base = 2; // >20° flex OR any extension (negative)
  if (n.twisted) base += 1;
  if (n.sideBent) base += 1;
  return base;
}

/** Legs: 1=bilateral support / walking, 2=unilateral / unstable.
 *  +1 if knee flexion 30-60°, +2 if >60° (not while sitting). */
function legsScore(l: RebaInput['legs']): number {
  let base = l.bilateralSupport ? 1 : 2;
  const k = l.kneeFlexionDeg;
  if (k > 60) base += 2;
  else if (k >= 30) base += 1;
  return base;
}

/** Upper arm: 1=20° ext-20° flex, 2=>20° ext or 20-45° flex, 3=45-90° flex, 4=>90°.
 *  +1 shoulder raised, +1 abducted, -1 supported. */
function upperArmScore(u: RebaInput['upperArm']): number {
  const f = u.flexionDeg;
  let base: number;
  if (f >= -20 && f <= 20) base = 1;
  else if (f < -20) base = 2;
  else if (f > 20 && f <= 45) base = 2;
  else if (f > 45 && f <= 90) base = 3;
  else base = 4; // >90° flexion
  if (u.shoulderRaised) base += 1;
  if (u.abducted) base += 1;
  if (u.supported) base -= 1;
  return Math.max(1, base);
}

/** Lower arm: 1=60-100° flex, 2=<60° or >100°. */
function lowerArmScore(l: RebaInput['lowerArm']): number {
  const f = l.flexionDeg;
  return f >= 60 && f <= 100 ? 1 : 2;
}

/** Wrist: 1=0-15° flex/ext, 2=>15° flex/ext. +1 if twisted/deviated. */
function wristScore(w: RebaInput['wrist']): number {
  const f = Math.abs(w.flexionDeg);
  let base = f <= 15 ? 1 : 2;
  if (w.twistedOrDeviated) base += 1;
  return base;
}

/** Load: 0 if <5kg, +1 if 5-10kg, +2 if >10kg, additional +1 if shock/rapid. */
function loadScore(l: RebaInput['load']): number {
  let s: number;
  if (l.kg < 5) s = 0;
  else if (l.kg <= 10) s = 1;
  else s = 2;
  if (l.shockOrRapid) s += 1;
  return s;
}

/** Coupling: good=0, fair=1, poor=2, unacceptable=3. */
function couplingScore(c: RebaInput['coupling']): number {
  switch (c) {
    case 'good':
      return 0;
    case 'fair':
      return 1;
    case 'poor':
      return 2;
    case 'unacceptable':
      return 3;
  }
}

/** Activity: +1 per flag (max 3). */
function activityScoreOf(a: RebaInput['activity']): number {
  let s = 0;
  if (a.staticOver1Min) s += 1;
  if (a.repeatedSmallRange) s += 1;
  if (a.rapidLargeRangeChanges) s += 1;
  return s;
}

// ─────────────────────────────────────────────────────────────────────
// Action level mapping (per the REBA worksheet)
// ─────────────────────────────────────────────────────────────────────

function actionLevelFor(score: number): RebaResult['actionLevel'] {
  if (score === 1) return 'negligible';
  if (score <= 3) return 'low';
  if (score <= 7) return 'medium';
  if (score <= 10) return 'high';
  return 'very_high';
}

const RECOMMENDATIONS: Readonly<Record<RebaResult['actionLevel'], string>> = {
  negligible: 'Riesgo insignificante. No se requiere intervención.',
  low: 'Riesgo bajo. Puede ser necesario un cambio.',
  medium: 'Riesgo medio. Es necesaria una intervención pronto.',
  high: 'Riesgo alto. Es necesaria una intervención inmediata.',
  very_high: 'Riesgo muy alto. Implementar cambios ahora.',
};

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

function validate(input: RebaInput): void {
  if (!input || typeof input !== 'object') {
    throw new Error('REBA: input is required');
  }
  if (!input.trunk || !input.neck || !input.legs) {
    throw new Error('REBA: trunk, neck and legs are required');
  }
  if (!input.upperArm || !input.lowerArm || !input.wrist) {
    throw new Error('REBA: upperArm, lowerArm and wrist are required');
  }
  if (!input.load) throw new Error('REBA: load is required');
  if (!input.coupling) throw new Error('REBA: coupling is required');
  if (!input.activity) throw new Error('REBA: activity is required');

  const angles: Array<[string, number]> = [
    ['trunk.flexionDeg', input.trunk.flexionDeg],
    ['neck.flexionDeg', input.neck.flexionDeg],
    ['upperArm.flexionDeg', input.upperArm.flexionDeg],
    ['lowerArm.flexionDeg', input.lowerArm.flexionDeg],
    ['wrist.flexionDeg', input.wrist.flexionDeg],
  ];
  for (const [name, v] of angles) {
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new Error(`REBA: ${name} must be a finite number`);
    }
    if (Math.abs(v) > 180) {
      throw new Error(`REBA: ${name} (${v}) is out of range [-180, 180]`);
    }
  }
  if (typeof input.legs.kneeFlexionDeg !== 'number' || input.legs.kneeFlexionDeg < 0) {
    throw new Error('REBA: legs.kneeFlexionDeg must be a non-negative number');
  }
  if (typeof input.load.kg !== 'number' || input.load.kg < 0) {
    throw new Error('REBA: load.kg must be a non-negative number');
  }
  if (
    input.coupling !== 'good' &&
    input.coupling !== 'fair' &&
    input.coupling !== 'poor' &&
    input.coupling !== 'unacceptable'
  ) {
    throw new Error(`REBA: coupling must be one of good|fair|poor|unacceptable`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export function calculateReba(input: RebaInput): RebaResult {
  validate(input);

  const tScore = trunkScore(input.trunk); // 1..5
  const nScore = neckScore(input.neck); // 1..3
  const lScore = legsScore(input.legs); // 1..4
  const uaScore = upperArmScore(input.upperArm); // 1..6
  const laScore = lowerArmScore(input.lowerArm); // 1..2
  const wScore = wristScore(input.wrist); // 1..3

  const tableA =
    TABLE_A[clamp(tScore, 1, 5) - 1][clamp(nScore, 1, 3) - 1][
      clamp(lScore, 1, 4) - 1
    ];
  const tableB =
    TABLE_B[clamp(uaScore, 1, 6) - 1][clamp(laScore, 1, 2) - 1][
      clamp(wScore, 1, 3) - 1
    ];

  const scoreA = tableA + loadScore(input.load);
  const scoreB = tableB + couplingScore(input.coupling);

  const aIdx = clamp(scoreA, 1, 12) - 1;
  const bIdx = clamp(scoreB, 1, 12) - 1;
  const scoreC = TABLE_C[aIdx][bIdx];

  const activityScore = activityScoreOf(input.activity);
  const finalScore = clamp(scoreC + activityScore, 1, 15);
  const actionLevel = actionLevelFor(finalScore);

  return {
    scoreA,
    scoreB,
    scoreC,
    activityScore,
    finalScore,
    actionLevel,
    recommendation: RECOMMENDATIONS[actionLevel],
  };
}
