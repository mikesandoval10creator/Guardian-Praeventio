import { describe, it, expect } from 'vitest';
import {
  computeObjectiveProgress,
  validateObjective,
  buildAnnualReview,
  type PreventiveObjective,
} from './annualSgiReview.js';

function obj(over: Partial<PreventiveObjective> & { id: string }): PreventiveObjective {
  return {
    id: over.id,
    fiscalYear: 2026,
    title: 'Reducir vencidos 30%',
    description: '',
    metric: 'percent_reduction',
    baseline: 100,
    target: 70,
    currentValue: 85,
    deadline: '2026-12-31T23:59:59Z',
    ownerUid: 'o1',
    status: 'in_progress',
    linkedActionIds: ['ca1'],
    evidenceUrls: ['url1'],
    ...over,
  };
}

describe('computeObjectiveProgress', () => {
  it('reducción: 100→70 con current=85 → 50% progress', () => {
    const r = computeObjectiveProgress(obj({ id: 'o' }), '2026-07-01T00:00:00Z');
    expect(r.progressPercent).toBe(50);
    expect(r.isAchieved).toBe(false);
  });

  it('100% logrado cuando current==target', () => {
    const r = computeObjectiveProgress(
      obj({ id: 'o', currentValue: 70 }),
      '2026-07-01T00:00:00Z',
    );
    expect(r.isAchieved).toBe(true);
    expect(r.suggestedStatus).toBe('achieved');
  });

  it('past deadline + no achieved → missed', () => {
    const r = computeObjectiveProgress(
      obj({ id: 'o', currentValue: 90 }),
      '2027-02-01T00:00:00Z',
    );
    expect(r.daysRemaining).toBeLessThan(0);
    expect(r.suggestedStatus).toBe('missed');
  });

  it('aumento: increase metric con target > baseline funciona', () => {
    const r = computeObjectiveProgress(
      obj({
        id: 'o',
        metric: 'count_increase',
        baseline: 10,
        target: 20,
        currentValue: 15,
      }),
      '2026-06-01T00:00:00Z',
    );
    expect(r.progressPercent).toBe(50);
  });
});

describe('validateObjective', () => {
  it('detecta no_linked_actions', () => {
    const issues = validateObjective(obj({ id: 'o', linkedActionIds: [] }));
    expect(issues.some((i) => i.issue === 'no_linked_actions')).toBe(true);
  });

  it('detecta no_evidence_yet en in_progress', () => {
    const issues = validateObjective(obj({ id: 'o', evidenceUrls: [] }));
    expect(issues.some((i) => i.issue === 'no_evidence_yet')).toBe(true);
  });

  it('detecta unrealistic_target (reducción con target >= baseline)', () => {
    const issues = validateObjective(obj({ id: 'o', baseline: 10, target: 20 }));
    expect(issues.some((i) => i.issue === 'unrealistic_target')).toBe(true);
  });

  it('detecta past_deadline_pending', () => {
    const issues = validateObjective(
      obj({ id: 'o', deadline: '2025-12-31T00:00:00Z' }),
      '2026-05-11T00:00:00Z',
    );
    expect(issues.some((i) => i.issue === 'past_deadline_pending')).toBe(true);
  });
});

describe('buildAnnualReview', () => {
  it('cuenta por status sugerido + achievementRate', () => {
    const r = buildAnnualReview(
      [
        obj({ id: 'achieved', currentValue: 70 }), // achieved
        obj({ id: 'inflight', currentValue: 85 }), // será on_track/at_risk según fecha
      ],
      2026,
      '2026-06-01T00:00:00Z',
    );
    expect(r.totalObjectives).toBe(2);
    expect(r.achieved).toBe(1);
    expect(r.achievementRate).toBe(50);
  });

  it('filtra por fiscalYear', () => {
    const r = buildAnnualReview(
      [obj({ id: 'a', fiscalYear: 2026 }), obj({ id: 'b', fiscalYear: 2027 })],
      2026,
    );
    expect(r.totalObjectives).toBe(1);
  });

  it('topPerformers lista solo achieved', () => {
    const r = buildAnnualReview(
      [
        obj({ id: 'a', currentValue: 70 }),
        obj({ id: 'b', currentValue: 70 }),
        obj({ id: 'c', currentValue: 95 }),
      ],
      2026,
      '2026-06-01T00:00:00Z',
    );
    expect(r.topPerformers).toHaveLength(2);
  });
});
