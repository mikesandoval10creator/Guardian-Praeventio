/**
 * Sprint 14 — SOSButton long-press timing tests.
 *
 * The repo intentionally does not ship `jsdom` / `happy-dom` /
 * `@testing-library/react` (see PredictedActivityModal.test.tsx for the
 * rationale). We exercise the production long-press contract via the
 * exported `isLongPress(downAt, upAt, holdMs)` helper, which is the same
 * predicate the component's `onPointerUp` handler calls to decide whether
 * the press should fire SOS or be cancelled.
 *
 * Coverage:
 *   • Short tap (<3s) → does NOT trigger.
 *   • Boundary (exactly 3s) → triggers (≥ holdMs).
 *   • Long press (>3s) → triggers.
 *   • Custom hold threshold → respects override.
 */

import { describe, expect, it } from 'vitest';
import { isLongPress } from './SOSButton';

describe('SOSButton — long-press predicate', () => {
  it('short tap (1s) does NOT count as a long press', () => {
    const down = 1_000;
    const up = down + 1_000;
    expect(isLongPress(down, up)).toBe(false);
  });

  it('2.999s hold does NOT count as a long press (sub-3s)', () => {
    const down = 0;
    const up = 2_999;
    expect(isLongPress(down, up)).toBe(false);
  });

  it('exactly 3s hold triggers (>= holdMs boundary)', () => {
    const down = 0;
    const up = 3_000;
    expect(isLongPress(down, up)).toBe(true);
  });

  it('5s hold triggers', () => {
    const down = 10_000;
    const up = 15_000;
    expect(isLongPress(down, up)).toBe(true);
  });

  it('custom hold threshold is respected (e.g., 1.5s in tests)', () => {
    expect(isLongPress(0, 1_499, 1_500)).toBe(false);
    expect(isLongPress(0, 1_500, 1_500)).toBe(true);
  });
});
