import { describe, it, expect } from 'vitest';
import {
  compareProjects,
  extractBestPractices,
  flagRiskProjects,
  type ProjectSnapshot,
} from './projectComparator.js';

function snap(over: Partial<ProjectSnapshot> & Pick<ProjectSnapshot, 'projectId' | 'projectName'>): ProjectSnapshot {
  return {
    industry: 'construction',
    workersCount: 100,
    totalHoursWorked: 200_000,
    incidents: {
      totalRecordable: 2,
      lostTime: 1,
      restrictedOrTransferred: 0,
      seriousInjuriesAndFatalities: 0,
      fatalities: 0,
      totalLostDays: 5,
    },
    complianceTrafficLightScore: 75,
    trainingCoverage: 80,
    eppCoverage: 85,
    openCorrectiveActions: 3,
    closedCorrectiveActions: 7,
    daysSinceLastIncident: 30,
    ...over,
  };
}

describe('compareProjects', () => {
  it('empty input → empty report', () => {
    const r = compareProjects([]);
    expect(r.scores).toEqual([]);
    expect(r.topProject).toBeNull();
    expect(r.worstProject).toBeNull();
    expect(r.averages.overallScore).toBe(0);
  });

  it('ranks topProject by overallScore', () => {
    const r = compareProjects([
      snap({ projectId: 'p1', projectName: 'Top', complianceTrafficLightScore: 95, trainingCoverage: 100, eppCoverage: 100 }),
      snap({ projectId: 'p2', projectName: 'Mid', complianceTrafficLightScore: 60 }),
      snap({ projectId: 'p3', projectName: 'Low', complianceTrafficLightScore: 30, trainingCoverage: 20, eppCoverage: 30 }),
    ]);
    expect(r.topProject?.projectId).toBe('p1');
    expect(r.worstProject?.projectId).toBe('p3');
  });

  it('TRIR computed correctly', () => {
    const r = compareProjects([
      snap({ projectId: 'p1', projectName: 'P1' }),
    ]);
    // 2 recordable × 200k / 200k = 2.0
    expect(r.scores[0].trir).toBe(2);
  });

  it('closureRate 7/(3+7) = 0.7', () => {
    const r = compareProjects([snap({ projectId: 'p1', projectName: 'P1' })]);
    expect(r.scores[0].correctiveActionClosureRate).toBe(0.7);
  });

  it('flags TRIR outliers >2x average', () => {
    const r = compareProjects([
      snap({ projectId: 'p1', projectName: 'A', incidents: { ...snap({ projectId: 'x', projectName: 'x' }).incidents, totalRecordable: 1 } }),
      snap({ projectId: 'p2', projectName: 'B', incidents: { ...snap({ projectId: 'x', projectName: 'x' }).incidents, totalRecordable: 1 } }),
      snap({ projectId: 'p3', projectName: 'OUTLIER', incidents: { ...snap({ projectId: 'x', projectName: 'x' }).incidents, totalRecordable: 10 } }),
    ]);
    expect(r.trirOutliers).toContain('p3');
  });

  it('averages calculated correctly', () => {
    const r = compareProjects([
      snap({ projectId: 'p1', projectName: 'A', complianceTrafficLightScore: 60 }),
      snap({ projectId: 'p2', projectName: 'B', complianceTrafficLightScore: 80 }),
      snap({ projectId: 'p3', projectName: 'C', complianceTrafficLightScore: 100 }),
    ]);
    expect(r.averages.compliance).toBe(80);
  });
});

describe('extractBestPractices', () => {
  it('encuentra best practice cuando top supera promedio +10', () => {
    const report = compareProjects([
      snap({ projectId: 'top', projectName: 'TOP', complianceTrafficLightScore: 95, trainingCoverage: 95 }),
      snap({ projectId: 'mid', projectName: 'MID', complianceTrafficLightScore: 60, trainingCoverage: 60 }),
      snap({ projectId: 'low', projectName: 'LOW', complianceTrafficLightScore: 40, trainingCoverage: 40 }),
    ]);
    const practices = extractBestPractices(report);
    expect(practices.length).toBeGreaterThan(0);
    expect(practices.some((p) => p.metric === 'compliance')).toBe(true);
    expect(practices.some((p) => p.metric === 'training_coverage')).toBe(true);
  });

  it('sin best practices si top no supera significativamente', () => {
    const report = compareProjects([
      snap({ projectId: 'a', projectName: 'A', complianceTrafficLightScore: 75, trainingCoverage: 80, eppCoverage: 85 }),
      snap({ projectId: 'b', projectName: 'B', complianceTrafficLightScore: 73, trainingCoverage: 78, eppCoverage: 83 }),
    ]);
    expect(extractBestPractices(report)).toHaveLength(0);
  });
});

describe('flagRiskProjects', () => {
  it('flag proyectos en multiple riesgo', () => {
    const report = compareProjects([
      snap({
        projectId: 'risky',
        projectName: 'RISKY',
        complianceTrafficLightScore: 40,
        trainingCoverage: 30,
        eppCoverage: 40,
        daysSinceLastIncident: 2,
      }),
      snap({ projectId: 'ok', projectName: 'OK' }),
    ]);
    const alerts = flagRiskProjects(report);
    const risky = alerts.find((a) => a.projectId === 'risky');
    expect(risky?.reasons.length).toBeGreaterThan(3);
    expect(risky?.reasons.some((r) => /Semáforo/.test(r))).toBe(true);
  });

  it('ordena por cantidad de razones desc', () => {
    const report = compareProjects([
      snap({ projectId: 'a', projectName: 'A', complianceTrafficLightScore: 30 }),
      snap({ projectId: 'b', projectName: 'B', complianceTrafficLightScore: 30, trainingCoverage: 20, eppCoverage: 20 }),
    ]);
    const alerts = flagRiskProjects(report);
    expect(alerts[0].projectId).toBe('b');
  });

  it('proyectos limpios → no alerts', () => {
    const report = compareProjects([
      snap({ projectId: 'clean', projectName: 'CLEAN' }),
    ]);
    expect(flagRiskProjects(report)).toEqual([]);
  });
});
