import { describe, it, expect } from 'vitest';
import {
  computeRiskScore,
  rankRisks,
  computeControlWeakness,
  rankWeakControls,
  rankZonesByFindings,
  rankTasksByRisk,
  type RiskRecord,
  type ControlRecord,
  type ZoneStats,
  type TaskRiskRecord,
} from './riskRankingEngine.js';

function risk(over: Partial<RiskRecord> = {}): RiskRecord {
  return {
    id: 'r1',
    projectId: 'p1',
    category: 'altura',
    severity: 'medium',
    exposedWorkerCount: 5,
    recentFindingCount: 0,
    linkedIncidentCount: 0,
    overdueActionCount: 0,
    ...over,
  };
}

describe('computeRiskScore', () => {
  it('critical pesa más que low', () => {
    const a = computeRiskScore(risk({ severity: 'critical' }));
    const b = computeRiskScore(risk({ severity: 'low' }));
    expect(a).toBeGreaterThan(b);
  });

  it('incidentes vinculados aumentan score', () => {
    const sin = computeRiskScore(risk({ linkedIncidentCount: 0 }));
    const con = computeRiskScore(risk({ linkedIncidentCount: 3 }));
    expect(con).toBeGreaterThan(sin);
  });

  it('exposedWorkerCount > 50 se trunca', () => {
    const a = computeRiskScore(risk({ exposedWorkerCount: 100 }));
    const b = computeRiskScore(risk({ exposedWorkerCount: 50 }));
    expect(a).toBe(b);
  });
});

describe('rankRisks', () => {
  it('ordena por score descendente', () => {
    const ranked = rankRisks([
      risk({ id: 'a', severity: 'low' }),
      risk({ id: 'b', severity: 'critical' }),
      risk({ id: 'c', severity: 'medium' }),
    ]);
    expect(ranked[0].id).toBe('b');
    expect(ranked[2].id).toBe('a');
  });

  it('respeta topN', () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      risk({ id: `r${i}`, severity: 'medium' }),
    );
    expect(rankRisks(records, 5)).toHaveLength(5);
  });
});

describe('computeControlWeakness', () => {
  it('nunca verificado → weaknessScore alto', () => {
    const w = computeControlWeakness({
      id: 'c1',
      projectId: 'p1',
      label: 'Test',
      verificationCount: 0,
      failureCount: 0,
      daysSinceLastVerification: 365,
    });
    expect(w.weaknessScore).toBeGreaterThan(100);
    expect(w.isOverdueVerification).toBe(true);
  });

  it('alta tasa de falla → score alto', () => {
    const w = computeControlWeakness({
      id: 'c1',
      projectId: 'p1',
      label: 'Test',
      verificationCount: 10,
      failureCount: 8,
      daysSinceLastVerification: 5,
    });
    expect(w.failureRate).toBe(0.8);
    expect(w.weaknessScore).toBe(80);
  });

  it('verificado regularmente sin fallas → score 0', () => {
    const w = computeControlWeakness({
      id: 'c1',
      projectId: 'p1',
      label: 'Test',
      verificationCount: 10,
      failureCount: 0,
      daysSinceLastVerification: 5,
    });
    expect(w.weaknessScore).toBe(0);
  });
});

describe('rankWeakControls', () => {
  it('ordena por weaknessScore descendente', () => {
    const records: ControlRecord[] = [
      { id: 'a', projectId: 'p1', label: 'OK control', verificationCount: 10, failureCount: 0, daysSinceLastVerification: 5 },
      { id: 'b', projectId: 'p1', label: 'Weak', verificationCount: 5, failureCount: 4, daysSinceLastVerification: 40 },
      { id: 'c', projectId: 'p1', label: 'Never verified', verificationCount: 0, failureCount: 0, daysSinceLastVerification: 100 },
    ];
    const ranked = rankWeakControls(records);
    expect(ranked[0].controlId === 'b' || ranked[0].controlId === 'c').toBe(true);
    expect(ranked[ranked.length - 1].controlId).toBe('a');
  });
});

describe('rankZonesByFindings', () => {
  it('ordena por findings + incidents + workers', () => {
    const zones: ZoneStats[] = [
      { zoneId: 'low', findingsCount: 1, incidentsCount: 0, workersAssigned: 2 },
      { zoneId: 'high', findingsCount: 10, incidentsCount: 3, workersAssigned: 15 },
      { zoneId: 'mid', findingsCount: 4, incidentsCount: 1, workersAssigned: 8 },
    ];
    const ranked = rankZonesByFindings(zones);
    expect(ranked[0].zoneId).toBe('high');
    expect(ranked[ranked.length - 1].zoneId).toBe('low');
  });
});

describe('rankTasksByRisk', () => {
  it('missingCriticalControls pesa más', () => {
    const tasks: TaskRiskRecord[] = [
      { taskId: 'safe', riskCategory: 'altura', workersAssigned: 5, incidentHistory: 0, missingCriticalControls: 0 },
      { taskId: 'gap', riskCategory: 'altura', workersAssigned: 5, incidentHistory: 0, missingCriticalControls: 3 },
    ];
    const ranked = rankTasksByRisk(tasks);
    expect(ranked[0].taskId).toBe('gap');
  });
});
