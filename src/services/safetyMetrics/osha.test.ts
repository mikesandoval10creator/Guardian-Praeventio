import { describe, it, expect } from 'vitest';
import {
  calculateRate,
  calculateTrir,
  calculateLtifr,
  calculateDart,
  calculateSifr,
  calculateSeverityRate,
  calculateFrequencyIndex,
  calculateFatalityRate,
  buildSafetyMetricsReport,
  analyzeTrend,
  compareTrirVsIndustry,
  compareLtifrVsIndustry,
  BASE_FACTORS,
  type IncidentCounts,
  type ExposureInput,
} from './osha.js';

const ZERO: IncidentCounts = {
  totalRecordable: 0,
  lostTime: 0,
  restrictedOrTransferred: 0,
  seriousInjuriesAndFatalities: 0,
  fatalities: 0,
  totalLostDays: 0,
};

describe('calculateRate', () => {
  it('(events × base) / hours', () => {
    // 2 incidentes en 100k horas con base 200k → tasa 4
    expect(calculateRate(2, 100_000, 200_000)).toBe(4);
  });
  it('hours=0 → 0 (sin exposición no podemos reportar tasa)', () => {
    expect(calculateRate(5, 0, 200_000)).toBe(0);
  });
  it('eventos negativos → NaN', () => {
    expect(Number.isNaN(calculateRate(-1, 100_000, 200_000))).toBe(true);
  });
});

describe('TRIR', () => {
  it('benchmark: 1 recordable en 100k horas → 2.0 TRIR', () => {
    const trir = calculateTrir(
      { ...ZERO, totalRecordable: 1 },
      { totalHoursWorked: 100_000 },
    );
    expect(trir).toBe(2);
  });
  it('cero recordables → 0', () => {
    expect(calculateTrir(ZERO, { totalHoursWorked: 200_000 })).toBe(0);
  });
});

describe('LTIFR', () => {
  it('1 lost-time en 1M horas → 1.0', () => {
    expect(
      calculateLtifr({ ...ZERO, lostTime: 1 }, { totalHoursWorked: 1_000_000 }),
    ).toBe(1);
  });
});

describe('DART', () => {
  it('suma lostTime + restrictedOrTransferred', () => {
    const dart = calculateDart(
      { ...ZERO, lostTime: 1, restrictedOrTransferred: 2 },
      { totalHoursWorked: 200_000 },
    );
    // 3 × 200k / 200k = 3
    expect(dart).toBe(3);
  });
});

describe('SIFR + fatalityRate + severityRate', () => {
  it('SIFR usa base 1M', () => {
    const sifr = calculateSifr(
      { ...ZERO, seriousInjuriesAndFatalities: 2 },
      { totalHoursWorked: 2_000_000 },
    );
    expect(sifr).toBe(1);
  });

  it('fatalityRate', () => {
    expect(
      calculateFatalityRate({ ...ZERO, fatalities: 1 }, { totalHoursWorked: 500_000 }),
    ).toBe(2);
  });

  it('severityRate por días perdidos', () => {
    expect(
      calculateSeverityRate(
        { ...ZERO, totalLostDays: 20 },
        { totalHoursWorked: 200_000 },
      ),
    ).toBe(20);
  });
});

describe('frequencyIndex (ILO base 1M)', () => {
  it('uses ILO base', () => {
    expect(
      calculateFrequencyIndex(
        { ...ZERO, totalRecordable: 5 },
        { totalHoursWorked: 1_000_000 },
      ),
    ).toBe(5);
  });
});

describe('buildSafetyMetricsReport', () => {
  it('emite todas las métricas en una llamada', () => {
    const counts: IncidentCounts = {
      totalRecordable: 4,
      lostTime: 2,
      restrictedOrTransferred: 1,
      seriousInjuriesAndFatalities: 1,
      fatalities: 0,
      totalLostDays: 15,
    };
    const expo: ExposureInput = { totalHoursWorked: 400_000 };
    const r = buildSafetyMetricsReport(counts, expo, '2026-Q1');
    expect(r.trir).toBeCloseTo(2, 5);
    expect(r.ltifr).toBeCloseTo(5, 5);
    expect(r.dart).toBeCloseTo(1.5, 5);
    expect(r.sifr).toBeCloseTo(2.5, 5);
    expect(r.severityRate).toBeCloseTo(7.5, 5);
    expect(r.periodLabel).toBe('2026-Q1');
    expect(r.totalHoursWorked).toBe(400_000);
  });
});

describe('analyzeTrend', () => {
  const base = buildSafetyMetricsReport(ZERO, { totalHoursWorked: 200_000 });
  it('improving cuando la métrica baja', () => {
    const previous = { ...base, trir: 5 };
    const current = { ...base, trir: 3 };
    expect(analyzeTrend(current, previous, 'trir').direction).toBe('improving');
  });

  it('worsening cuando sube significativamente', () => {
    const previous = { ...base, trir: 2 };
    const current = { ...base, trir: 4 };
    expect(analyzeTrend(current, previous, 'trir').direction).toBe('worsening');
  });

  it('stable bajo umbral 5%', () => {
    const previous = { ...base, trir: 3 };
    const current = { ...base, trir: 3.1 };
    expect(analyzeTrend(current, previous, 'trir').direction).toBe('stable');
  });

  it('previous=0 y current>0 → +100% worsening', () => {
    const previous = { ...base, trir: 0 };
    const current = { ...base, trir: 1 };
    const t = analyzeTrend(current, previous, 'trir');
    expect(t.deltaPercent).toBe(100);
    expect(t.direction).toBe('worsening');
  });
});

describe('industry benchmarks', () => {
  it('TRIR mining_cl: 1.0 mejor que benchmark 1.8', () => {
    const cmp = compareTrirVsIndustry(1.0, 'mining_cl');
    expect(cmp.benchmark).toBe(1.8);
    expect(cmp.betterThanBenchmark).toBe(true);
    expect(cmp.percentOfBenchmark).toBeLessThan(100);
  });

  it('LTIFR construction_cl: 25 peor que benchmark 18', () => {
    const cmp = compareLtifrVsIndustry(25, 'construction_cl');
    expect(cmp.betterThanBenchmark).toBe(false);
  });
});

describe('BASE_FACTORS canónicos', () => {
  it('OSHA = 200_000', () => {
    expect(BASE_FACTORS.osha_200k).toBe(200_000);
  });
  it('ILO = 1_000_000', () => {
    expect(BASE_FACTORS.ilo_1m).toBe(1_000_000);
  });
});
