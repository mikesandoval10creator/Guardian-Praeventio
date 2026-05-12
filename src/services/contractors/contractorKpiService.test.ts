import { describe, it, expect } from 'vitest';
import {
  computeContractorKpi,
  rankContractorsByRisk,
  buildAcreditationGapReport,
  type ContractorPerformance,
} from './contractorKpiService.js';

function perf(over: Partial<ContractorPerformance> & { contractorId: string }): ContractorPerformance {
  return {
    contractorId: over.contractorId,
    legalName: over.legalName ?? `C ${over.contractorId}`,
    manDaysWorked: 100,
    manHoursWorked: over.manHoursWorked ?? 100_000,
    recordableIncidents: over.recordableIncidents ?? 0,
    lostTimeDays: over.lostTimeDays ?? 0,
    overdueActions: over.overdueActions ?? 0,
    trainingCompletionRate: over.trainingCompletionRate ?? 1,
    documentationCurrentRate: over.documentationCurrentRate ?? 1,
  };
}

describe('computeContractorKpi', () => {
  it('contratista limpio → green', () => {
    const r = computeContractorKpi(perf({ contractorId: 'c1' }));
    expect(r.level).toBe('green');
    expect(r.trir).toBe(0);
  });

  it('TRIR formula correct', () => {
    const r = computeContractorKpi(
      perf({ contractorId: 'c1', recordableIncidents: 1, manHoursWorked: 200_000 }),
    );
    expect(r.trir).toBe(1.0); // (1 * 200000) / 200000
  });

  it('contractor con muchos incidentes → red', () => {
    const r = computeContractorKpi(
      perf({
        contractorId: 'c1',
        recordableIncidents: 20,
        manHoursWorked: 200_000,
        overdueActions: 15,
        trainingCompletionRate: 0.3,
        documentationCurrentRate: 0.3,
      }),
    );
    expect(r.level).toBe('red');
  });

  it('compliance score promedia training + docs', () => {
    const r = computeContractorKpi(
      perf({
        contractorId: 'c1',
        trainingCompletionRate: 0.8,
        documentationCurrentRate: 0.6,
      }),
    );
    expect(r.complianceScore).toBe(70); // (80 + 60)/2
  });
});

describe('rankContractorsByRisk', () => {
  it('ordena por riskScore descendente', () => {
    const r = rankContractorsByRisk([
      perf({ contractorId: 'safe' }),
      perf({
        contractorId: 'risky',
        recordableIncidents: 10,
        manHoursWorked: 100_000,
      }),
    ]);
    expect(r[0].contractorId).toBe('risky');
  });
});

describe('buildAcreditationGapReport', () => {
  it('cuenta resolved / pending / overdue', () => {
    const r = buildAcreditationGapReport(
      {
        contractorId: 'c1',
        status: 'observed',
        observations: [
          {
            id: 'o1',
            issue: 'x',
            dueAt: '2026-04-01T00:00:00Z',
            resolved: false,
          }, // overdue
          {
            id: 'o2',
            issue: 'y',
            dueAt: '2026-06-01T00:00:00Z',
            resolved: false,
          }, // pending
          {
            id: 'o3',
            issue: 'z',
            dueAt: '2026-05-01T00:00:00Z',
            resolved: true,
            resolvedAt: '2026-05-10',
          },
        ],
      },
      '2026-05-11T00:00:00Z',
    );
    expect(r.totalObservations).toBe(3);
    expect(r.resolved).toBe(1);
    expect(r.pending).toBe(2);
    expect(r.overdue).toBe(1);
    expect(r.canOperate).toBe(false);
  });

  it('canOperate=true solo si approved + 0 overdue', () => {
    const r = buildAcreditationGapReport({
      contractorId: 'c1',
      status: 'approved',
      observations: [],
    });
    expect(r.canOperate).toBe(true);
  });

  it('approved con overdue → no puede operar', () => {
    const r = buildAcreditationGapReport(
      {
        contractorId: 'c1',
        status: 'approved',
        observations: [
          { id: 'o1', issue: 'x', dueAt: '2026-04-01T00:00:00Z', resolved: false },
        ],
      },
      '2026-05-11T00:00:00Z',
    );
    expect(r.canOperate).toBe(false);
  });
});
