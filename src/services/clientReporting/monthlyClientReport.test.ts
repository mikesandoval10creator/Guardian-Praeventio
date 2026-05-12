import { describe, it, expect } from 'vitest';
import { buildMonthlyClientReport, type MonthlyInputs } from './monthlyClientReport.js';

function inputs(over: Partial<MonthlyInputs> = {}): MonthlyInputs {
  return {
    projectId: 'p1',
    periodLabel: '2026-04',
    totalIncidents: 5,
    criticalIncidents: 0,
    totalActions: 20,
    closedActions: 15,
    trainingHoursCompleted: 100,
    workersActive: 50,
    complianceScore: 85,
    sifPrecursors: 0,
    slaCommitments: [{ name: 'closure_rate', target: 80, achieved: 75 }],
    ...over,
  };
}

describe('buildMonthlyClientReport', () => {
  it('genera KPIs core', () => {
    const r = buildMonthlyClientReport(inputs());
    expect(r.kpis.length).toBeGreaterThanOrEqual(4);
    expect(r.kpis.some((k) => /Compliance/i.test(k.name))).toBe(true);
  });

  it('reputational alert urgente si SIF precursor', () => {
    const r = buildMonthlyClientReport(inputs({ sifPrecursors: 2 }));
    expect(r.reputationalAlerts.some((a) => a.severity === 'urgent')).toBe(true);
  });

  it('reputational alert urgente si incidente crítico', () => {
    const r = buildMonthlyClientReport(inputs({ criticalIncidents: 1 }));
    expect(r.reputationalAlerts.some((a) => a.severity === 'urgent')).toBe(true);
  });

  it('SLA at_risk si entre 85% y 100%', () => {
    const r = buildMonthlyClientReport(
      inputs({ slaCommitments: [{ name: 'sla1', target: 100, achieved: 90 }] }),
    );
    expect(r.slaCompliance[0].status).toBe('at_risk');
  });

  it('SLA missed si <85%', () => {
    const r = buildMonthlyClientReport(
      inputs({ slaCommitments: [{ name: 'sla1', target: 100, achieved: 50 }] }),
    );
    expect(r.slaCompliance[0].status).toBe('missed');
  });

  it('trends comparan con prevPeriod', () => {
    const r = buildMonthlyClientReport(
      inputs({
        totalIncidents: 5,
        prevPeriod: { totalIncidents: 10, complianceScore: 80, closedActions: 10 },
      }),
    );
    const incidents = r.kpis.find((k) => /Incidentes/i.test(k.name));
    expect(incidents?.trend).toBe('up'); // bajó incidentes → "up" en trend (lowerIsBetter)
  });

  it('executiveSummary tiene el periodo y métricas', () => {
    const r = buildMonthlyClientReport(inputs());
    expect(r.executiveSummary).toMatch(/2026-04/);
    expect(r.executiveSummary).toMatch(/85\/100/);
  });
});
