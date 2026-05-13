import { describe, it, expect } from 'vitest';
import {
  summarizeAccreditation,
  shouldEscalateObservation,
  resolveObservation,
  type AccreditationObservation,
} from './vendorAccreditationTracker.js';

function obs(
  id: string,
  overrides: Partial<AccreditationObservation> = {},
): AccreditationObservation {
  return {
    id,
    vendorId: 'v1',
    observedByUid: 'reviewer-1',
    kind: 'documentation',
    severity: 'minor',
    description: 'doc por vencer',
    observedAt: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('summarizeAccreditation', () => {
  it('returns clean status when no observations', () => {
    const s = summarizeAccreditation('v1', []);
    expect(s.openObservations).toBe(0);
    expect(s.criticalCount).toBe(0);
    expect(s.eligibleForRecurringWork).toBe(true);
    expect(s.reasonIfNot).toBeUndefined();
  });

  it('counts only open observations as open', () => {
    const s = summarizeAccreditation('v1', [
      obs('o1', { severity: 'minor', resolvedAt: '2026-05-11T00:00:00.000Z' }),
      obs('o2', { severity: 'minor' }),
    ]);
    expect(s.openObservations).toBe(1);
    expect(s.minorCount).toBe(1);
  });

  it('marks not eligible when ≥1 critical open', () => {
    const s = summarizeAccreditation('v1', [obs('o1', { severity: 'critical' })]);
    expect(s.criticalCount).toBe(1);
    expect(s.eligibleForRecurringWork).toBe(false);
    expect(s.reasonIfNot).toMatch(/crítica/i);
  });

  it('remains eligible if critical is resolved', () => {
    const s = summarizeAccreditation('v1', [
      obs('o1', { severity: 'critical', resolvedAt: '2026-05-11T00:00:00.000Z' }),
    ]);
    expect(s.criticalCount).toBe(0);
    expect(s.eligibleForRecurringWork).toBe(true);
  });

  it('marks not eligible at 3 open mayors', () => {
    const s = summarizeAccreditation('v1', [
      obs('a', { severity: 'major' }),
      obs('b', { severity: 'major' }),
      obs('c', { severity: 'major' }),
    ]);
    expect(s.majorCount).toBe(3);
    expect(s.eligibleForRecurringWork).toBe(false);
    expect(s.reasonIfNot).toMatch(/mayores/i);
  });

  it('stays eligible with 2 open mayors', () => {
    const s = summarizeAccreditation('v1', [
      obs('a', { severity: 'major' }),
      obs('b', { severity: 'major' }),
    ]);
    expect(s.eligibleForRecurringWork).toBe(true);
  });

  it('exposes lastObservationAt (most recent)', () => {
    const s = summarizeAccreditation('v1', [
      obs('a', { observedAt: '2026-05-01T00:00:00.000Z' }),
      obs('b', { observedAt: '2026-05-10T00:00:00.000Z' }),
      obs('c', { observedAt: '2026-05-05T00:00:00.000Z' }),
    ]);
    expect(s.lastObservationAt).toBe('2026-05-10T00:00:00.000Z');
  });

  it('filters observations to the requested vendor', () => {
    const s = summarizeAccreditation('v1', [
      obs('a', { vendorId: 'v2', severity: 'critical' }),
      obs('b', { severity: 'minor' }),
    ]);
    expect(s.criticalCount).toBe(0);
    expect(s.openObservations).toBe(1);
    expect(s.eligibleForRecurringWork).toBe(true);
  });
});

describe('shouldEscalateObservation', () => {
  it('escalates any critical immediately', () => {
    const o = obs('o1', { severity: 'critical' });
    expect(shouldEscalateObservation(o, [])).toBe(true);
  });

  it('does not escalate isolated minor', () => {
    expect(shouldEscalateObservation(obs('o1', { severity: 'minor' }), [])).toBe(false);
  });

  it('escalates a major when there are ≥2 prior same-kind in window', () => {
    const recent = obs('o1', {
      severity: 'major',
      kind: 'epp_quality',
      observedAt: '2026-05-10T00:00:00.000Z',
    });
    const history: AccreditationObservation[] = [
      obs('p1', {
        severity: 'major',
        kind: 'epp_quality',
        observedAt: '2026-05-05T00:00:00.000Z',
      }),
      obs('p2', {
        severity: 'major',
        kind: 'epp_quality',
        observedAt: '2026-04-25T00:00:00.000Z',
      }),
    ];
    expect(shouldEscalateObservation(recent, history)).toBe(true);
  });

  it('does not escalate isolated major outside repetition window', () => {
    const recent = obs('o1', {
      severity: 'major',
      kind: 'epp_quality',
      observedAt: '2026-05-10T00:00:00.000Z',
    });
    const history: AccreditationObservation[] = [
      obs('p1', {
        severity: 'major',
        kind: 'epp_quality',
        observedAt: '2025-01-01T00:00:00.000Z', // way out of 30d window
      }),
    ];
    expect(shouldEscalateObservation(recent, history)).toBe(false);
  });
});

describe('resolveObservation', () => {
  it('returns a new resolved observation, leaving original intact', () => {
    const o = obs('o1', { severity: 'major' });
    const r = resolveObservation(o, 'reviewer-9', '2026-05-13T00:00:00.000Z', 'cerrado');
    expect(r.resolvedAt).toBe('2026-05-13T00:00:00.000Z');
    expect(r.resolvedByUid).toBe('reviewer-9');
    expect(r.resolutionNotes).toBe('cerrado');
    expect(o.resolvedAt).toBeUndefined(); // pure
  });
});
