import { describe, it, expect } from 'vitest';
import {
  rankWeakControlsFromValidations,
  type ControlValidationInput,
} from './controlValidationAggregation';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-05T00:00:00Z');

function v(
  controlId: string,
  present: boolean,
  daysAgo = 0,
): ControlValidationInput {
  return {
    controlId,
    present,
    validatedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  };
}

describe('rankWeakControlsFromValidations', () => {
  it('groups by controlId and counts verifications + failures', () => {
    const ranked = rankWeakControlsFromValidations(
      [v('c1', true, 1), v('c1', false, 2), v('c1', true, 3), v('c2', true, 1)],
      { nowMs: NOW },
    );
    const c1 = ranked.find((r) => r.controlId === 'c1')!;
    // c1: 3 verifications, 1 failure → failureRate 1/3.
    expect(c1.failureRate).toBeCloseTo(1 / 3, 5);
    // c2: clean → ranks below c1.
    expect(ranked[0]!.controlId).toBe('c1');
  });

  it('ranks higher-failure-rate controls first', () => {
    const ranked = rankWeakControlsFromValidations(
      [
        v('bad', false, 1),
        v('bad', false, 2), // 100% failure
        v('ok', true, 1),
        v('ok', true, 2), // 0% failure
      ],
      { nowMs: NOW },
    );
    expect(ranked[0]!.controlId).toBe('bad');
    expect(ranked[0]!.failureRate).toBe(1);
    expect(ranked[1]!.failureRate).toBe(0);
  });

  it('flags overdue verification (>30 days) and never-verified', () => {
    const ranked = rankWeakControlsFromValidations(
      [v('stale', true, 45), v('fresh', true, 2)],
      { nowMs: NOW },
    );
    const stale = ranked.find((r) => r.controlId === 'stale')!;
    const fresh = ranked.find((r) => r.controlId === 'fresh')!;
    expect(stale.isOverdueVerification).toBe(true);
    expect(fresh.isOverdueVerification).toBe(false);
    // overdue adds to the weakness score → stale ranks above fresh.
    expect(stale.weaknessScore).toBeGreaterThan(fresh.weaknessScore);
  });

  it('resolves labels via labelFor, falling back to controlId', () => {
    const ranked = rankWeakControlsFromValidations([v('alt-eng-baranda', true, 1)], {
      nowMs: NOW,
      labelFor: (id) => (id === 'alt-eng-baranda' ? 'Barandas perimetrales' : id),
    });
    expect(ranked[0]!.label).toBe('Barandas perimetrales');
    const noLabel = rankWeakControlsFromValidations([v('unknown-ctrl', true, 1)], {
      nowMs: NOW,
    });
    expect(noLabel[0]!.label).toBe('unknown-ctrl');
  });

  it('respects topN and ignores malformed entries without throwing', () => {
    const many: ControlValidationInput[] = Array.from({ length: 15 }, (_, i) =>
      v(`c${i}`, i % 2 === 0, 1),
    );
    expect(rankWeakControlsFromValidations(many, { nowMs: NOW, topN: 5 })).toHaveLength(5);
    expect(() =>
      rankWeakControlsFromValidations(
        [
          { controlId: '', present: true, validatedAt: 'x' }, // empty id → skipped
          { controlId: 'c', present: true, validatedAt: 'not-a-date' }, // bad date
        ],
        { nowMs: NOW },
      ),
    ).not.toThrow();
  });

  it('treats a control whose dates are all unparseable as never-verified (overdue)', () => {
    const ranked = rankWeakControlsFromValidations(
      [{ controlId: 'c', present: true, validatedAt: 'garbage' }],
      { nowMs: NOW },
    );
    expect(ranked[0]!.isOverdueVerification).toBe(true);
  });
});
