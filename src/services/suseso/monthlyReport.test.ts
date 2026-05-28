// Praeventio Guard — Tests §12.7.6 Reportes mensuales SUSESO.
//
// Cobertura: builder determinístico de reporte mensual que consume
// `cumplimientoCalculator` + agrega contexto mes-sobre-mes + benchmark.

import { describe, it, expect } from 'vitest';
import {
  buildMonthlyReport,
  monthLabelEsCL,
  type MonthlyReportInput,
} from './monthlyReport';

const baseCurrent = {
  averageWorkers: 100,
  accidentsWithTimeLoss: 5,
  daysLost: 50,
  manHoursWorked: 200_000,
};

const baseMeta = {
  companyName: 'Constructora Andes Ltda.',
  rut: '76.123.456-7',
};

describe('buildMonthlyReport — período + tasas', () => {
  it('arma período correcto para mes específico (2026-01)', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 1,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    });
    expect(report.period.fromIso).toBe('2026-01-01T00:00:00.000Z');
    expect(report.period.toIso).toBe('2026-01-31T23:59:59.999Z');
    expect(report.period.monthLabel).toBe('enero 2026');
  });

  it('último día del mes correcto en febrero año NO bisiesto (2026)', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 2,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    });
    expect(report.period.toIso).toBe('2026-02-28T23:59:59.999Z');
  });

  it('último día del mes correcto en febrero año bisiesto (2028)', () => {
    const report = buildMonthlyReport({
      year: 2028,
      month: 2,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    });
    expect(report.period.toIso).toBe('2028-02-29T23:59:59.999Z');
  });

  it('último día abril (30 días)', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 4,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    });
    expect(report.period.toIso).toBe('2026-04-30T23:59:59.999Z');
  });

  it('current.tasaAccidentabilidad delega al calculator (5%)', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 1,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    });
    expect(report.current.tasaAccidentabilidad).toBe(5);
  });
});

describe('buildMonthlyReport — mes sobre mes', () => {
  it('sin mes previo → monthOverMonth undefined', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 1,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    });
    expect(report.previous).toBeUndefined();
    expect(report.monthOverMonth).toBeUndefined();
  });

  it('con mes previo → calcula delta % por tasa', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 2,
      currentMonthData: baseCurrent, // TA 5%
      previousMonthData: {
        averageWorkers: 100,
        accidentsWithTimeLoss: 4, // TA 4%
        daysLost: 40,
        manHoursWorked: 200_000,
      },
      metadata: baseMeta,
    });
    expect(report.previous?.tasaAccidentabilidad).toBe(4);
    // (5 - 4) / 4 * 100 = 25%
    expect(report.monthOverMonth?.tasaAccDeltaPct).toBe(25);
  });

  it('mes previo TA = 0 → delta sin división por cero (undefined o 0)', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 2,
      currentMonthData: baseCurrent,
      previousMonthData: {
        averageWorkers: 100,
        accidentsWithTimeLoss: 0,
        daysLost: 0,
        manHoursWorked: 200_000,
      },
      metadata: baseMeta,
    });
    expect(report.monthOverMonth?.tasaAccDeltaPct).toBeUndefined();
  });
});

describe('buildMonthlyReport — benchmark sector', () => {
  it('con benchmark → incluye comparación', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 1,
      currentMonthData: baseCurrent,
      benchmark: {
        industrySector: 'Construcción',
        sectorAvgTasaAccidentabilidad: 4,
        sectorAvgTasaSiniestralidad: 60,
      },
      metadata: baseMeta,
    });
    expect(report.benchmark?.industrySector).toBe('Construcción');
    expect(report.benchmark?.delta.tasaAccidentabilidad).toBe(1); // 5 - 4
  });
});

describe('buildMonthlyReport — metadata + resumen', () => {
  it('preserva metadata empresa', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 1,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    });
    expect(report.metadata.companyName).toBe('Constructora Andes Ltda.');
    expect(report.metadata.rut).toBe('76.123.456-7');
  });

  it('resumen ejecutivo no vacío + cita TA', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 1,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    });
    expect(report.summary.length).toBeGreaterThan(30);
    expect(report.summary).toContain('5');
  });

  it('reportId determinístico por mes+año+rut', () => {
    const input: MonthlyReportInput = {
      year: 2026,
      month: 3,
      currentMonthData: baseCurrent,
      metadata: baseMeta,
    };
    const a = buildMonthlyReport(input);
    const b = buildMonthlyReport(input);
    expect(a.reportId).toBe(b.reportId);
    expect(a.reportId).toContain('2026-03');
  });

  it('alerts del current se propagan al reporte', () => {
    const report = buildMonthlyReport({
      year: 2026,
      month: 1,
      // TA 8% > 6% → critical alert
      currentMonthData: {
        averageWorkers: 100,
        accidentsWithTimeLoss: 8,
        daysLost: 50,
        manHoursWorked: 200_000,
      },
      metadata: baseMeta,
    });
    expect(report.current.alerts.length).toBeGreaterThan(0);
    expect(report.current.alerts[0]?.severity).toBe('critical');
  });
});

describe('monthLabelEsCL', () => {
  it('formato es-CL', () => {
    expect(monthLabelEsCL(2026, 1)).toBe('enero 2026');
    expect(monthLabelEsCL(2026, 7)).toBe('julio 2026');
    expect(monthLabelEsCL(2026, 12)).toBe('diciembre 2026');
  });

  it('rejects invalid month', () => {
    expect(() => monthLabelEsCL(2026, 0)).toThrow();
    expect(() => monthLabelEsCL(2026, 13)).toThrow();
  });
});

describe('determinismo', () => {
  it('mismas entradas → mismo output', () => {
    const input: MonthlyReportInput = {
      year: 2026,
      month: 5,
      currentMonthData: baseCurrent,
      previousMonthData: {
        averageWorkers: 100,
        accidentsWithTimeLoss: 4,
        daysLost: 40,
        manHoursWorked: 200_000,
      },
      metadata: baseMeta,
    };
    const a = buildMonthlyReport(input);
    const b = buildMonthlyReport(input);
    expect(a).toEqual(b);
  });
});
