// Praeventio Guard — Sprint 55 Fase F.27 service tests.
//
// Exercises:
//   - validation guards (min/max, IDs, %, negative)
//   - normalization (lower_is_better vs higher_is_better)
//   - winner selection
//   - overall ranking + kpiWins
//   - observations
//   - determinism (snapshot orden estable)

import { describe, it, expect } from 'vitest';
import {
  compareProjects,
  validateSnapshots,
  ProjectComparatorError,
  MAX_PROJECTS_TO_COMPARE,
  METRIC_DIRECTIONS,
  METRIC_LABELS_ES,
  type ProjectSnapshot,
} from './projectComparator';

function snap(
  id: string,
  name: string,
  overrides: Partial<ProjectSnapshot['metrics']> = {},
): ProjectSnapshot {
  return {
    projectId: id,
    projectName: name,
    snapshotAt: '2026-05-17T12:00:00Z',
    metrics: {
      incidentCount: 5,
      openFindingsCount: 12,
      auditCompliancePct: 80,
      criticalRisksCount: 2,
      workersCount: 40,
      correctiveActionsOnTimePct: 75,
      ...overrides,
    },
  };
}

describe('validateSnapshots', () => {
  it('rejects fewer than MIN_PROJECTS_TO_COMPARE', () => {
    expect(() => validateSnapshots([snap('p1', 'A')])).toThrow(ProjectComparatorError);
  });

  it('rejects more than MAX_PROJECTS_TO_COMPARE', () => {
    const tooMany = Array.from({ length: MAX_PROJECTS_TO_COMPARE + 1 }, (_, i) =>
      snap(`p${i}`, `Proj ${i}`),
    );
    expect(() => validateSnapshots(tooMany)).toThrow(/TOO_MANY_PROJECTS/);
  });

  it('rejects duplicate projectId', () => {
    expect(() =>
      validateSnapshots([snap('p1', 'A'), snap('p1', 'B')]),
    ).toThrow(/DUPLICATE_PROJECT/);
  });

  it('rejects missing projectId', () => {
    expect(() =>
      validateSnapshots([snap('p1', 'A'), { ...snap('p2', 'B'), projectId: '' }]),
    ).toThrow(/INVALID_ID/);
  });

  it('rejects auditCompliancePct out of [0,100]', () => {
    expect(() =>
      validateSnapshots([snap('p1', 'A'), snap('p2', 'B', { auditCompliancePct: 150 })]),
    ).toThrow(/INVALID_PCT/);
  });

  it('rejects negative counts', () => {
    expect(() =>
      validateSnapshots([snap('p1', 'A'), snap('p2', 'B', { incidentCount: -1 })]),
    ).toThrow(/NEGATIVE_COUNT/);
  });
});

describe('METRIC_DIRECTIONS / METRIC_LABELS_ES', () => {
  it('declares direction for every ranked metric', () => {
    expect(METRIC_DIRECTIONS.incidentCount).toBe('lower_is_better');
    expect(METRIC_DIRECTIONS.openFindingsCount).toBe('lower_is_better');
    expect(METRIC_DIRECTIONS.criticalRisksCount).toBe('lower_is_better');
    expect(METRIC_DIRECTIONS.auditCompliancePct).toBe('higher_is_better');
    expect(METRIC_DIRECTIONS.correctiveActionsOnTimePct).toBe('higher_is_better');
  });

  it('ES labels match direction map keys', () => {
    expect(Object.keys(METRIC_LABELS_ES).sort()).toEqual(
      Object.keys(METRIC_DIRECTIONS).sort(),
    );
  });
});

describe('compareProjects', () => {
  it('ranks lower_is_better correctly (incidents)', () => {
    const report = compareProjects([
      snap('p1', 'Norte', { incidentCount: 1 }),
      snap('p2', 'Sur', { incidentCount: 10 }),
    ]);
    const mc = report.metricComparisons.find((m) => m.metric === 'incidentCount');
    expect(mc).toBeDefined();
    expect(mc!.winnerProjectId).toBe('p1');
    expect(mc!.bestValue).toBe(1);
    expect(mc!.worstValue).toBe(10);
    expect(mc!.normalizedScores[0]).toBe(100);
    expect(mc!.normalizedScores[1]).toBe(0);
  });

  it('ranks higher_is_better correctly (audit compliance)', () => {
    const report = compareProjects([
      snap('p1', 'Norte', { auditCompliancePct: 60 }),
      snap('p2', 'Sur', { auditCompliancePct: 95 }),
    ]);
    const mc = report.metricComparisons.find((m) => m.metric === 'auditCompliancePct');
    expect(mc!.winnerProjectId).toBe('p2');
    expect(mc!.normalizedScores[1]).toBe(100);
    expect(mc!.normalizedScores[0]).toBe(0);
  });

  it('handles tied values (null winner, both 100)', () => {
    const report = compareProjects([
      snap('p1', 'A', { incidentCount: 5 }),
      snap('p2', 'B', { incidentCount: 5 }),
    ]);
    const mc = report.metricComparisons.find((m) => m.metric === 'incidentCount');
    expect(mc!.winnerProjectId).toBeNull();
    expect(mc!.normalizedScores).toEqual([100, 100]);
  });

  it('computes overall ranking sorted desc by score', () => {
    const report = compareProjects([
      // p1 is best across the board
      snap('p1', 'Best', {
        incidentCount: 1,
        openFindingsCount: 1,
        auditCompliancePct: 99,
        criticalRisksCount: 0,
        correctiveActionsOnTimePct: 95,
      }),
      snap('p2', 'Worst', {
        incidentCount: 20,
        openFindingsCount: 30,
        auditCompliancePct: 40,
        criticalRisksCount: 8,
        correctiveActionsOnTimePct: 30,
      }),
    ]);
    expect(report.overallRanking[0].projectId).toBe('p1');
    expect(report.overallRanking[0].overallScore).toBe(100);
    expect(report.overallRanking[0].kpiWins).toBe(5);
    expect(report.overallRanking[1].projectId).toBe('p2');
    expect(report.overallRanking[1].overallScore).toBe(0);
  });

  it('emits "significant difference" observation when gap >= 20', () => {
    const report = compareProjects([
      snap('p1', 'Bueno', {
        incidentCount: 0,
        openFindingsCount: 0,
        criticalRisksCount: 0,
        auditCompliancePct: 100,
        correctiveActionsOnTimePct: 100,
      }),
      snap('p2', 'Malo', {
        incidentCount: 50,
        openFindingsCount: 50,
        criticalRisksCount: 10,
        auditCompliancePct: 0,
        correctiveActionsOnTimePct: 0,
      }),
    ]);
    expect(
      report.observations.some((o) => /Diferencia significativa/i.test(o)),
    ).toBe(true);
  });

  it('emits "leads in all KPIs" when one wins all', () => {
    const report = compareProjects([
      snap('p1', 'Líder', {
        incidentCount: 0,
        openFindingsCount: 0,
        criticalRisksCount: 0,
        auditCompliancePct: 100,
        correctiveActionsOnTimePct: 100,
      }),
      snap('p2', 'Promedio', {
        incidentCount: 5,
        openFindingsCount: 10,
        criticalRisksCount: 2,
        auditCompliancePct: 50,
        correctiveActionsOnTimePct: 60,
      }),
    ]);
    expect(report.observations.some((o) => /lidera en todos/i.test(o))).toBe(true);
  });

  it('handles 4 projects (MAX_PROJECTS_TO_COMPARE)', () => {
    const report = compareProjects([
      snap('p1', 'A'),
      snap('p2', 'B'),
      snap('p3', 'C'),
      snap('p4', 'D'),
    ]);
    expect(report.overallRanking).toHaveLength(4);
    expect(report.projects).toHaveLength(4);
    expect(report.metricComparisons[0].values).toHaveLength(4);
  });

  it('uses options.now when provided', () => {
    const report = compareProjects([snap('p1', 'A'), snap('p2', 'B')], {
      now: new Date('2027-01-01T00:00:00Z'),
    });
    expect(report.generatedAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('preserves input project order in metricComparisons.values', () => {
    const report = compareProjects([
      snap('p3', 'C', { incidentCount: 3 }),
      snap('p1', 'A', { incidentCount: 1 }),
      snap('p2', 'B', { incidentCount: 2 }),
    ]);
    const mc = report.metricComparisons.find((m) => m.metric === 'incidentCount');
    expect(mc!.values).toEqual([3, 1, 2]);
    expect(report.projects.map((p) => p.projectId)).toEqual(['p3', 'p1', 'p2']);
  });
});
