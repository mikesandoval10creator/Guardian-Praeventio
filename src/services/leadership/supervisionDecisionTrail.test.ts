import { describe, it, expect } from 'vitest';
import {
  scoreDecisionImpact,
  rankSupervisorsByImpact,
  summarizeDecisionTrail,
  type SupervisionDecision,
} from './supervisionDecisionTrail.js';

function decision(over: Partial<SupervisionDecision> & { id: string }): SupervisionDecision {
  return {
    id: over.id,
    supervisorUid: over.supervisorUid ?? 'sup1',
    decidedAt: over.decidedAt ?? '2026-05-11T10:00:00Z',
    kind: over.kind ?? 'authorize_work',
    context: over.context ?? 'contexto',
    rationale: over.rationale ?? 'razón',
    involvedRef: over.involvedRef,
    outcome: over.outcome,
  };
}

describe('scoreDecisionImpact', () => {
  it('reject_unsafe pesa más que authorize_work', () => {
    const reject = scoreDecisionImpact(decision({ id: 'a', kind: 'reject_unsafe' }));
    const authorize = scoreDecisionImpact(decision({ id: 'b', kind: 'authorize_work' }));
    expect(reject.totalScore).toBeGreaterThan(authorize.totalScore);
  });

  it('outcome positivo añade bonus', () => {
    const withOutcome = scoreDecisionImpact(
      decision({
        id: 'a',
        kind: 'stop_task',
        outcome: { positive: true, description: 'previno caída', recordedAt: 't' },
      }),
    );
    const without = scoreDecisionImpact(decision({ id: 'b', kind: 'stop_task' }));
    expect(withOutcome.totalScore).toBeGreaterThan(without.totalScore);
  });
});

describe('rankSupervisorsByImpact', () => {
  it('ordena por totalImpactScore descendente', () => {
    const decisions = [
      decision({ id: 'a1', supervisorUid: 'sup1', kind: 'authorize_work' }),
      decision({ id: 'a2', supervisorUid: 'sup1', kind: 'reject_unsafe' }),
      decision({ id: 'b1', supervisorUid: 'sup2', kind: 'authorize_work' }),
      decision({ id: 'b2', supervisorUid: 'sup2', kind: 'authorize_work' }),
    ];
    const ranking = rankSupervisorsByImpact(decisions);
    expect(ranking[0].supervisorUid).toBe('sup1'); // mayor score gracias a reject_unsafe
  });

  it('calcula positiveOutcomeRate', () => {
    const decisions = [
      decision({
        id: 'a',
        supervisorUid: 'sup1',
        outcome: { positive: true, description: 'ok', recordedAt: 't' },
      }),
      decision({
        id: 'b',
        supervisorUid: 'sup1',
        outcome: { positive: false, description: 'no logró', recordedAt: 't' },
      }),
      decision({ id: 'c', supervisorUid: 'sup1' }), // sin outcome
    ];
    const ranking = rankSupervisorsByImpact(decisions);
    expect(ranking[0].positiveOutcomeRate).toBe(50);
  });
});

describe('summarizeDecisionTrail', () => {
  it('top 5 ordenado por score', () => {
    const ds = [
      decision({ id: 'a', kind: 'authorize_work' }),
      decision({ id: 'b', kind: 'reject_unsafe' }),
      decision({ id: 'c', kind: 'stop_task' }),
    ];
    const s = summarizeDecisionTrail(ds);
    expect(s.topImpactDecisions[0].decision.id).toBe('b'); // reject_unsafe = 30
  });

  it('cuenta byKind', () => {
    const ds = [
      decision({ id: 'a', kind: 'authorize_work' }),
      decision({ id: 'b', kind: 'authorize_work' }),
      decision({ id: 'c', kind: 'stop_task' }),
    ];
    const s = summarizeDecisionTrail(ds);
    expect(s.byKind.authorize_work).toBe(2);
    expect(s.byKind.stop_task).toBe(1);
  });
});
