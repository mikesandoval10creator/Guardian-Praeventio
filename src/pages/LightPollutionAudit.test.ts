// Round 15 / I4 — DS 594 Art. 103 lighting audit pure-helpers.

import { describe, expect, it } from 'vitest';

// We import the helpers as named exports. The full page is a tsx; the helpers
// live alongside the component but are pure and don't touch React.
import { averageLux, isCompliant, TASK_THRESHOLDS } from './LightPollutionAudit';

describe('averageLux', () => {
  it('returns 0 for empty input', () => {
    expect(averageLux([])).toBe(0);
  });

  it('rounds to nearest integer', () => {
    expect(averageLux([300, 301, 302])).toBe(301);
  });

  it('ignores non-finite or negative values', () => {
    expect(averageLux([100, Number.NaN, -5, 200])).toBe(150);
  });

  it('returns 0 if all values are invalid', () => {
    expect(averageLux([Number.NaN, -1, Number.POSITIVE_INFINITY])).toBe(0);
  });
});

describe('isCompliant — DS 594 Art. 103 thresholds', () => {
  it('precision tasks require ≥500 lux', () => {
    expect(isCompliant(499, 'precision')).toBe(false);
    expect(isCompliant(500, 'precision')).toBe(true);
    expect(TASK_THRESHOLDS.precision.threshold).toBe(500);
  });

  it('regular tasks require ≥300 lux', () => {
    expect(isCompliant(299, 'regular')).toBe(false);
    expect(isCompliant(300, 'regular')).toBe(true);
  });

  it('basto tasks require ≥150 lux', () => {
    expect(isCompliant(149, 'basto')).toBe(false);
    expect(isCompliant(150, 'basto')).toBe(true);
  });

  it('transito requires ≥50 lux', () => {
    expect(isCompliant(49, 'transito')).toBe(false);
    expect(isCompliant(50, 'transito')).toBe(true);
  });
});
