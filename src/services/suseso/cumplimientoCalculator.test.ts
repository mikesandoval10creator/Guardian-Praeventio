// Praeventio Guard — Tests Dashboard Cumplimiento SUSESO (§12.7.5)
//
// Cobertura: fórmulas oficiales SUSESO/OIT + alertas regulatorias + edge
// cases (división por cero, fatales, datos negativos rejected).

import { describe, it, expect } from 'vitest';
import {
  calculateCumplimientoSuseso,
  compareAgainstSector,
  type CumplimientoInput,
} from './cumplimientoCalculator';

const basePeriod = {
  fromIso: '2026-01-01T00:00:00.000Z',
  toIso: '2026-01-31T23:59:59.999Z',
};

describe('calculateCumplimientoSuseso', () => {
  it('cálculo básico: 5 accidentes / 100 trabajadores = TA 5%', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 5,
      daysLost: 50,
      manHoursWorked: 200_000, // 100 workers × 8h × 250 días aprox
    };
    const result = calculateCumplimientoSuseso(input);
    expect(result.tasaAccidentabilidad).toBe(5);
    expect(result.tasaSiniestralidad).toBe(50);
  });

  it('TF = (accidentes × 1.000.000) / h-h trabajadas', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 4,
      daysLost: 30,
      manHoursWorked: 200_000,
    };
    const result = calculateCumplimientoSuseso(input);
    // 4 * 1.000.000 / 200.000 = 20
    expect(result.tasaFrecuencia).toBe(20);
  });

  it('TG = (días × 1M) / h-h', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 2,
      daysLost: 30,
      manHoursWorked: 200_000,
    };
    const result = calculateCumplimientoSuseso(input);
    // 30 * 1M / 200K = 150
    expect(result.tasaGravedad).toBe(150);
  });

  it('fatal aplica penalty 6000 días', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 1,
      daysLost: 10,
      manHoursWorked: 200_000,
      fatalAccidents: 1,
    };
    const result = calculateCumplimientoSuseso(input);
    // TG = (10 + 6000) * 1M / 200K = 30050
    expect(result.tasaGravedad).toBe(30_050);
    // TF cuenta fatal: (1+1) * 1M / 200K = 10
    expect(result.tasaFrecuencia).toBe(10);
  });

  it('Walsh index = √(TF × TG)', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 4,
      daysLost: 30,
      manHoursWorked: 200_000,
    };
    const result = calculateCumplimientoSuseso(input);
    // TF=20, TG=150 → Walsh=√3000≈54.77
    expect(result.indiceCompuestoWalsh).toBeCloseTo(54.77, 1);
  });

  it('alerta CRITICAL si TA > 6%', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 7,
      daysLost: 50,
      manHoursWorked: 200_000,
    };
    const result = calculateCumplimientoSuseso(input);
    const ta = result.alerts.find((a) => a.code === 'tasa_acc_high_risk');
    expect(ta).toBeDefined();
    expect(ta?.severity).toBe('critical');
    expect(ta?.message).toContain('recargo cotización SUSESO');
  });

  it('alerta WARNING si TA entre 4-6%', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 5,
      daysLost: 30,
      manHoursWorked: 200_000,
    };
    const result = calculateCumplimientoSuseso(input);
    const elev = result.alerts.find((a) => a.code === 'tasa_acc_elevated');
    expect(elev).toBeDefined();
    expect(elev?.severity).toBe('warning');
  });

  it('alerta fatal CRITICAL', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 0,
      daysLost: 0,
      manHoursWorked: 200_000,
      fatalAccidents: 1,
    };
    const result = calculateCumplimientoSuseso(input);
    const fat = result.alerts.find((a) => a.code === 'fatal_accident_period');
    expect(fat).toBeDefined();
    expect(fat?.severity).toBe('critical');
    expect(fat?.message).toContain('investigación obligatoria DS 30');
  });

  it('sin alertas si TA < 4%', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 3,
      daysLost: 20,
      manHoursWorked: 200_000,
    };
    const result = calculateCumplimientoSuseso(input);
    expect(result.alerts.filter((a) => a.severity !== 'info')).toHaveLength(0);
  });

  it('rechaza averageWorkers=0 (división por cero)', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 0,
      accidentsWithTimeLoss: 1,
      daysLost: 10,
      manHoursWorked: 100,
    };
    expect(() => calculateCumplimientoSuseso(input)).toThrow(/averageWorkers/);
  });

  it('rechaza manHoursWorked=0 (división por cero TF/TG)', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 1,
      daysLost: 10,
      manHoursWorked: 0,
    };
    expect(() => calculateCumplimientoSuseso(input)).toThrow(/manHoursWorked/);
  });

  it('rechaza valores negativos', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: -1,
      daysLost: 10,
      manHoursWorked: 100,
    };
    expect(() => calculateCumplimientoSuseso(input)).toThrow(/accidentsWithTimeLoss/);
  });

  it('redondeo a 2 decimales en todos los outputs', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 137,
      accidentsWithTimeLoss: 3,
      daysLost: 23,
      manHoursWorked: 264_321,
    };
    const result = calculateCumplimientoSuseso(input);
    // Verifica que cada output tenga máximo 2 decimales
    expect(Math.round(result.tasaAccidentabilidad * 100) / 100).toBe(result.tasaAccidentabilidad);
    expect(Math.round(result.tasaSiniestralidad * 100) / 100).toBe(result.tasaSiniestralidad);
    expect(Math.round(result.tasaFrecuencia * 100) / 100).toBe(result.tasaFrecuencia);
  });

  it('determinístico: mismas entradas → mismas salidas', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 5,
      daysLost: 50,
      manHoursWorked: 200_000,
    };
    const a = calculateCumplimientoSuseso(input);
    const b = calculateCumplimientoSuseso(input);
    expect(a).toEqual(b);
  });

  it('preserva inputs originales para auditabilidad', () => {
    const input: CumplimientoInput = {
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 5,
      daysLost: 50,
      manHoursWorked: 200_000,
    };
    const result = calculateCumplimientoSuseso(input);
    expect(result.inputs).toEqual(input);
  });
});

describe('compareAgainstSector', () => {
  it('delta positivo = peor que sector', () => {
    const result = calculateCumplimientoSuseso({
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 5,
      daysLost: 50,
      manHoursWorked: 200_000,
    });
    const benchmark = compareAgainstSector(result, {
      industrySector: 'GP-CONS-EDI',
      tasaAccidentabilidad: 3.5,
      tasaSiniestralidad: 35,
    });
    // tenant TA=5, sector=3.5 → delta +1.5
    expect(benchmark.delta.tasaAccidentabilidad).toBe(1.5);
    expect(benchmark.delta.tasaSiniestralidad).toBe(15);
    expect(benchmark.industrySector).toBe('GP-CONS-EDI');
  });

  it('delta negativo = mejor que sector', () => {
    const result = calculateCumplimientoSuseso({
      period: basePeriod,
      averageWorkers: 100,
      accidentsWithTimeLoss: 2,
      daysLost: 15,
      manHoursWorked: 200_000,
    });
    const benchmark = compareAgainstSector(result, {
      industrySector: 'GP-CONS-EDI',
      tasaAccidentabilidad: 3.5,
      tasaSiniestralidad: 35,
    });
    expect(benchmark.delta.tasaAccidentabilidad).toBe(-1.5);
    expect(benchmark.delta.tasaSiniestralidad).toBe(-20);
  });
});
