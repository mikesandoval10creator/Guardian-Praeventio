import { describe, it, expect } from 'vitest';
import {
  advanceStage,
  detectStuckProjects,
  summarizeCycle,
  type PDCAEntry,
  type PDCAProject,
} from './pdcaCycleEngine.js';

function entry(over: Partial<PDCAEntry> & { kind: PDCAEntry['kind'] }): PDCAEntry {
  return {
    kind: over.kind,
    activityId: over.activityId ?? `${over.kind}-1`,
    notes: over.notes ?? '',
    ownerUid: over.ownerUid ?? 'u-1',
    startedAt: over.startedAt ?? '2026-05-01T00:00:00Z',
    completedAt: over.completedAt,
    evidence: over.evidence,
    efficacyScore: over.efficacyScore,
  };
}

function project(over: Partial<PDCAProject> & { id: string }): PDCAProject {
  return {
    id: over.id,
    currentStage: over.currentStage ?? 'plan',
    stages: over.stages ?? [],
    cycleNumber: over.cycleNumber ?? 1,
  };
}

describe('advanceStage', () => {
  it('refuses to advance if current stage has no entry', () => {
    const r = advanceStage(project({ id: 'p', currentStage: 'plan', stages: [] }), ['ev']);
    expect(r.advanced).toBe(false);
    expect(r.reason).toBe('no_entry_for_current_stage');
  });

  it('refuses to advance if current stage is not completed', () => {
    const r = advanceStage(
      project({ id: 'p', currentStage: 'plan', stages: [entry({ kind: 'plan' })] }),
      ['ev'],
    );
    expect(r.reason).toBe('current_stage_not_completed');
  });

  it('refuses to advance if no evidence is provided', () => {
    const r = advanceStage(
      project({
        id: 'p',
        currentStage: 'plan',
        stages: [entry({ kind: 'plan', completedAt: '2026-05-02T00:00:00Z' })],
      }),
      [],
    );
    expect(r.reason).toBe('no_evidence_attached');
  });

  it('advances plan→do with evidence', () => {
    const r = advanceStage(
      project({
        id: 'p',
        currentStage: 'plan',
        stages: [entry({ kind: 'plan', completedAt: '2026-05-02T00:00:00Z' })],
      }),
      ['doc://plan.pdf'],
      '2026-05-02T01:00:00Z',
    );
    expect(r.advanced).toBe(true);
    expect(r.project.currentStage).toBe('do');
    expect(r.project.stages).toHaveLength(2);
    expect(r.project.stages[0].evidence).toContain('doc://plan.pdf');
  });

  it('advances act→plan and increments cycleNumber', () => {
    const r = advanceStage(
      project({
        id: 'p',
        currentStage: 'act',
        cycleNumber: 2,
        stages: [entry({ kind: 'act', completedAt: '2026-05-10T00:00:00Z' })],
      }),
      ['doc://act.pdf'],
    );
    expect(r.advanced).toBe(true);
    expect(r.project.currentStage).toBe('plan');
    expect(r.project.cycleNumber).toBe(3);
  });
});

describe('detectStuckProjects', () => {
  it('flags projects whose current stage stalled ≥14 days', () => {
    const stalled = project({
      id: 'p-1',
      currentStage: 'do',
      stages: [entry({ kind: 'do', startedAt: '2026-04-01T00:00:00Z' })],
    });
    const fresh = project({
      id: 'p-2',
      currentStage: 'do',
      stages: [entry({ kind: 'do', startedAt: '2026-05-10T00:00:00Z' })],
    });
    const result = detectStuckProjects([stalled, fresh], '2026-05-12T00:00:00Z');
    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe('p-1');
    expect(result[0].daysSinceStart).toBeGreaterThanOrEqual(14);
  });

  it('ignores projects whose stage was completed', () => {
    const done = project({
      id: 'p',
      currentStage: 'do',
      stages: [
        entry({
          kind: 'do',
          startedAt: '2026-04-01T00:00:00Z',
          completedAt: '2026-04-05T00:00:00Z',
        }),
      ],
    });
    expect(detectStuckProjects([done], '2026-05-12T00:00:00Z')).toEqual([]);
  });
});

describe('summarizeCycle', () => {
  it('computes days per stage, evidence count, and avg efficacy', () => {
    const p = project({
      id: 'p',
      cycleNumber: 1,
      stages: [
        entry({
          kind: 'plan',
          startedAt: '2026-05-01T00:00:00Z',
          completedAt: '2026-05-03T00:00:00Z',
          evidence: ['e1'],
        }),
        entry({
          kind: 'do',
          startedAt: '2026-05-03T00:00:00Z',
          completedAt: '2026-05-08T00:00:00Z',
          evidence: ['e2', 'e3'],
        }),
        entry({
          kind: 'act',
          startedAt: '2026-05-09T00:00:00Z',
          completedAt: '2026-05-10T00:00:00Z',
          efficacyScore: 80,
        }),
      ],
    });
    const s = summarizeCycle(p);
    expect(s.daysByStage.plan).toBe(2);
    expect(s.daysByStage.do).toBe(5);
    expect(s.evidenceCount).toBe(3);
    expect(s.avgEfficacyScore).toBe(80);
    expect(s.completedStages).toEqual(['plan', 'do', 'act']);
  });

  it('returns null avgEfficacyScore when no act has a score', () => {
    const p = project({
      id: 'p',
      stages: [entry({ kind: 'plan', completedAt: '2026-05-02T00:00:00Z' })],
    });
    expect(summarizeCycle(p).avgEfficacyScore).toBeNull();
  });
});
