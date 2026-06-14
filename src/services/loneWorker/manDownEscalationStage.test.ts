import { describe, it, expect } from 'vitest';
import {
  manDownLevelsForElapsed,
  manDownThresholds,
  MAN_DOWN_ESCALATION_LEVELS,
} from './manDownEscalationStage.js';
import { DEFAULT_MAN_DOWN_CONFIG } from './manDownTimer.js';

// Default cumulative thresholds: t1=60, t2=240, t3=540 (see DEFAULT_MAN_DOWN_CONFIG).
const { t1, t2, t3 } = manDownThresholds();

describe('manDownThresholds', () => {
  it('derives cumulative t1/t2/t3 from the config', () => {
    expect(t1).toBe(60); // preAlertToLevel1Sec
    expect(t2).toBe(240); // + level1ToLevel2Sec (180)
    expect(t3).toBe(540); // + level2ToLevel3Sec (300)
  });

  it('respects a custom config', () => {
    const custom = { ...DEFAULT_MAN_DOWN_CONFIG, preAlertToLevel1Sec: 10, level1ToLevel2Sec: 20, level2ToLevel3Sec: 30 };
    expect(manDownThresholds(custom)).toEqual({ t1: 10, t2: 30, t3: 60 });
  });
});

describe('manDownLevelsForElapsed', () => {
  it('below t1 → no escalation (pre-alert window)', () => {
    expect(manDownLevelsForElapsed(0)).toEqual([]);
    expect(manDownLevelsForElapsed(t1 - 1)).toEqual([]);
  });

  it('at/just-past t1 → supervisor only', () => {
    expect(manDownLevelsForElapsed(t1)).toEqual(['supervisor']);
    expect(manDownLevelsForElapsed(t2 - 1)).toEqual(['supervisor']);
  });

  it('at/just-past t2 → supervisor + brigade (cumulative)', () => {
    expect(manDownLevelsForElapsed(t2)).toEqual(['supervisor', 'brigade']);
    expect(manDownLevelsForElapsed(t3 - 1)).toEqual(['supervisor', 'brigade']);
  });

  it('at/past t3 → all three levels (cumulative)', () => {
    expect(manDownLevelsForElapsed(t3)).toEqual([
      'supervisor',
      'brigade',
      'emergency_services',
    ]);
    // First observation far past t3 still returns the FULL set so the
    // supervisor is paged too, not just emergency services.
    expect(manDownLevelsForElapsed(t3 + 100_000)).toEqual([
      'supervisor',
      'brigade',
      'emergency_services',
    ]);
  });

  it('returns [] for non-finite or negative elapsed (clock skew / bad data)', () => {
    expect(manDownLevelsForElapsed(-5)).toEqual([]);
    expect(manDownLevelsForElapsed(Number.NaN)).toEqual([]);
    expect(manDownLevelsForElapsed(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('the returned levels are always a prefix of MAN_DOWN_ESCALATION_LEVELS', () => {
    for (const elapsed of [t1, t2, t3, t3 + 1]) {
      const levels = manDownLevelsForElapsed(elapsed);
      expect(levels).toEqual(MAN_DOWN_ESCALATION_LEVELS.slice(0, levels.length));
    }
  });
});
