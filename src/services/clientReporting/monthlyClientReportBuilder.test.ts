import { describe, it, expect } from 'vitest';
import {
  buildMonthlyClientReport,
  type MonthlyReportInput,
} from './monthlyClientReportBuilder.js';

function baseInput(over: Partial<MonthlyReportInput> = {}): MonthlyReportInput {
  return {
    projectId: 'proj-1',
    projectName: 'Mina Norte',
    periodFrom: '2026-04-01T00:00:00Z',
    periodTo: '2026-04-30T23:59:59Z',
    metrics: {
      trir: 1.2,
      ltifr: 0.8,
      sif: 0,
      totalIncidents: 8,
      manHoursWorked: 120000,
    },
    achievements: ['30 días sin LTI', 'Auditoría ISO 45001 aprobada'],
    concerns: ['Backlog inspecciones en sector 3'],
    correctiveActions: { closed: 18, open: 4, averageClosureDays: 5.4 },
    trainingsCompleted: 22,
    inspectionsCompleted: 45,
    complianceScore: 85,
    spendBreakdownClp: {
      epp: 3_200_000,
      training: 1_800_000,
      audits: 900_000,
      engineering: 4_500_000,
    },
    ...over,
  };
}

describe('buildMonthlyClientReport', () => {
  it('genera cover page con período y nombre de proyecto', () => {
    const r = buildMonthlyClientReport(baseInput());
    expect(r.coverPage.projectName).toBe('Mina Norte');
    expect(r.coverPage.period.from).toBe('2026-04-01T00:00:00Z');
    expect(r.coverPage.period.to).toBe('2026-04-30T23:59:59Z');
    expect(r.coverPage.executiveSummary).toMatch(/./);
  });

  it('cae a projectId si no hay projectName', () => {
    const r = buildMonthlyClientReport(baseInput({ projectName: undefined }));
    expect(r.coverPage.projectName).toBe('proj-1');
  });

  it('incluye sección de métricas con TRIR/LTIFR/SIF/totales/horas-hombre', () => {
    const r = buildMonthlyClientReport(baseInput());
    const metrics = r.sections.find((s) => s.kind === 'metrics');
    expect(metrics).toBeDefined();
    const labels = metrics!.rows.map((row) => row.label);
    expect(labels).toContain('TRIR');
    expect(labels).toContain('LTIFR');
    expect(labels).toContain('Incidentes SIF');
    expect(labels).toContain('Incidentes totales');
    expect(labels).toContain('Horas-hombre trabajadas');
  });

  it('omite secciones de achievements/concerns si vacíos', () => {
    const r = buildMonthlyClientReport(
      baseInput({ achievements: [], concerns: [] }),
    );
    expect(r.sections.find((s) => s.kind === 'achievements')).toBeUndefined();
    expect(r.sections.find((s) => s.kind === 'concerns')).toBeUndefined();
  });

  it('callout crítico rojo cuando SIF > 0', () => {
    const r = buildMonthlyClientReport(
      baseInput({
        metrics: {
          trir: 1.2,
          ltifr: 0.8,
          sif: 1,
          totalIncidents: 9,
          manHoursWorked: 120000,
        },
      }),
    );
    expect(r.callouts.some((c) => c.severity === 'critical')).toBe(true);
  });

  it('callout warning amarillo cuando compliance < 70', () => {
    const r = buildMonthlyClientReport(baseInput({ complianceScore: 65 }));
    expect(r.callouts.some((c) => c.severity === 'warning')).toBe(true);
  });

  it('callout positivo cuando compliance ≥90 y sin SIF', () => {
    const r = buildMonthlyClientReport(baseInput({ complianceScore: 95 }));
    expect(r.callouts.some((c) => c.severity === 'positive')).toBe(true);
  });

  it('callout info por defecto si no hay hallazgos', () => {
    const r = buildMonthlyClientReport(baseInput({ complianceScore: 80 }));
    // Sin SIF, compliance 80 (no positivo, no warning), closureRate alto.
    expect(r.callouts.some((c) => c.severity === 'info')).toBe(true);
  });

  it('scoreCard.trend up si compliance subió vs período previo', () => {
    const r = buildMonthlyClientReport(
      baseInput({
        complianceScore: 85,
        previousPeriod: { metrics: {}, complianceScore: 75 },
      }),
    );
    expect(r.scoreCard.trend).toBe('up');
    expect(r.scoreCard.trendBadge).toContain('↑');
  });

  it('scoreCard.trend down si compliance bajó', () => {
    const r = buildMonthlyClientReport(
      baseInput({
        complianceScore: 70,
        previousPeriod: { metrics: {}, complianceScore: 80 },
      }),
    );
    expect(r.scoreCard.trend).toBe('down');
    expect(r.scoreCard.trendBadge).toContain('↓');
  });

  it('scoreCard.trend n_a si no hay período previo', () => {
    const r = buildMonthlyClientReport(baseInput());
    expect(r.scoreCard.trend).toBe('n_a');
    expect(r.scoreCard.trendBadge).toBe('n/a');
  });

  it('vs_benchmark muestra delta vs benchmark', () => {
    const r = buildMonthlyClientReport(
      baseInput({
        complianceScore: 85,
        benchmark: { complianceScore: 75 },
      }),
    );
    expect(r.scoreCard.vs_benchmark).toMatch(/\+10 pts/);
  });

  it('vs_benchmark null si no hay benchmark', () => {
    const r = buildMonthlyClientReport(baseInput());
    expect(r.scoreCard.vs_benchmark).toBeNull();
  });

  it('corrective_actions calcula closure rate y total', () => {
    const r = buildMonthlyClientReport(
      baseInput({
        correctiveActions: { closed: 7, open: 3, averageClosureDays: 4 },
      }),
    );
    const ca = r.sections.find((s) => s.kind === 'corrective_actions');
    const rate = ca!.rows.find((row) => row.label === 'Tasa de cierre');
    expect(rate?.value).toBe('70%');
  });

  it('callout warning si closure rate < 70%', () => {
    const r = buildMonthlyClientReport(
      baseInput({
        correctiveActions: { closed: 3, open: 7, averageClosureDays: 8 },
      }),
    );
    expect(r.callouts.some((c) => c.severity === 'warning' && /cierre/i.test(c.message))).toBe(true);
  });

  it('spend breakdown incluye total', () => {
    const r = buildMonthlyClientReport(baseInput());
    const spend = r.sections.find((s) => s.kind === 'spend');
    const total = spend!.rows.find((row) => row.label === 'Total');
    expect(total).toBeDefined();
    expect(total!.value).toContain('$');
  });

  it('audit metadata refleja conteos', () => {
    const r = buildMonthlyClientReport(baseInput(), { now: () => '2026-05-01T00:00:00Z' });
    expect(r.audit.builtAt).toBe('2026-05-01T00:00:00Z');
    expect(r.audit.sectionsCount).toBe(r.sections.length);
    expect(r.audit.calloutsCount).toBe(r.callouts.length);
  });

  it('métricas con trend muestran flat si delta = 0', () => {
    const r = buildMonthlyClientReport(
      baseInput({
        metrics: { trir: 1.2, ltifr: 0.8, sif: 0, totalIncidents: 8, manHoursWorked: 120000 },
        previousPeriod: { metrics: { trir: 1.2, totalIncidents: 8 } },
      }),
    );
    const metrics = r.sections.find((s) => s.kind === 'metrics')!;
    const trirRow = metrics.rows.find((row) => row.label === 'TRIR');
    expect(trirRow?.trend).toBe('flat');
  });
});
