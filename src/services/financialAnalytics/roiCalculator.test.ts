import { describe, it, expect } from 'vitest';
import {
  computeRoi,
  applyHeinrichRatio,
  compareToBenchmark,
  type PreventionInvestment,
  type AvoidedIncidentEstimate,
} from './roiCalculator.js';

describe('computeRoi (§175 + §178)', () => {
  const baseInvestments: PreventionInvestment[] = [
    { category: 'training', amountClp: 2_000_000 },
    { category: 'epp', amountClp: 3_000_000 },
    { category: 'audits', amountClp: 1_000_000 },
  ];

  const baseAvoided: AvoidedIncidentEstimate = {
    baselineRatePerYear: 5,
    currentRatePerYear: 2,
    averageDirectCostPerIncidentClp: 4_000_000,
  };

  it('suma todas las categorías de inversión', () => {
    const report = computeRoi(baseInvestments, baseAvoided);
    expect(report.totalInvestmentClp).toBe(6_000_000);
  });

  it('calcula incidentes evitados como baseline - current', () => {
    const report = computeRoi(baseInvestments, baseAvoided);
    expect(report.incidentsAvoidedPerYear).toBe(3);
  });

  it('aplica Heinrich 1:4 por defecto a costos indirectos', () => {
    const report = computeRoi(baseInvestments, baseAvoided);
    expect(report.directSavingsClp).toBe(12_000_000);
    expect(report.indirectSavingsClp).toBe(48_000_000);
    expect(report.totalSavingsClp).toBe(60_000_000);
  });

  it('respeta indirectMultiplier custom', () => {
    const report = computeRoi(baseInvestments, {
      ...baseAvoided,
      indirectMultiplier: 2,
    });
    expect(report.indirectSavingsClp).toBe(24_000_000);
    expect(report.notes.some((n) => n.includes('Heinrich'))).toBe(true);
  });

  it('marca verdict=profitable cuando ROI > 10%', () => {
    const report = computeRoi(baseInvestments, baseAvoided);
    expect(report.verdict).toBe('profitable');
    expect(report.roiPercent).toBeGreaterThan(10);
  });

  it('verdict=loss cuando savings < investment significativamente', () => {
    const report = computeRoi(
      [{ category: 'engineering', amountClp: 100_000_000 }],
      { ...baseAvoided, currentRatePerYear: 4.9 },
    );
    expect(report.verdict).toBe('loss');
  });

  it('verdict=breakeven cerca de 0% ROI', () => {
    const report = computeRoi(
      [{ category: 'epp', amountClp: 20_000_000 }],
      {
        baselineRatePerYear: 1,
        currentRatePerYear: 0,
        averageDirectCostPerIncidentClp: 4_000_000,
      },
    );
    // savings = 4M + 16M = 20M, investment 20M → ROI 0%
    expect(report.verdict).toBe('breakeven');
  });

  it('payback en meses se redondea a 1 decimal', () => {
    const report = computeRoi(baseInvestments, baseAvoided);
    expect(report.paybackMonths).toBeGreaterThan(0);
    expect(report.paybackMonths).toBeLessThan(12);
  });

  it('payback es Infinity si no hay ahorros', () => {
    const report = computeRoi(baseInvestments, {
      baselineRatePerYear: 1,
      currentRatePerYear: 1,
      averageDirectCostPerIncidentClp: 4_000_000,
    });
    expect(report.totalSavingsClp).toBe(0);
    expect(report.paybackMonths).toBe(Number.POSITIVE_INFINITY);
  });

  it('inversión 0 da nota especial', () => {
    const report = computeRoi([], baseAvoided);
    expect(report.totalInvestmentClp).toBe(0);
    expect(report.notes.some((n) => n.includes('Inversión 0'))).toBe(true);
  });

  it('ignora amounts negativos en inversión', () => {
    const report = computeRoi(
      [
        { category: 'training', amountClp: -500_000 },
        { category: 'epp', amountClp: 1_000_000 },
      ],
      baseAvoided,
    );
    expect(report.totalInvestmentClp).toBe(1_000_000);
  });

  it('reducción cero da nota explicativa', () => {
    const report = computeRoi(baseInvestments, {
      baselineRatePerYear: 3,
      currentRatePerYear: 3,
      averageDirectCostPerIncidentClp: 4_000_000,
    });
    expect(report.incidentsAvoidedPerYear).toBe(0);
    expect(report.notes.some((n) => n.includes('reducción'))).toBe(true);
  });
});

describe('applyHeinrichRatio (§178)', () => {
  it('aplica ratio 1:4 por defecto', () => {
    const out = applyHeinrichRatio(1_000_000);
    expect(out.directCostClp).toBe(1_000_000);
    expect(out.indirectCostClp).toBe(4_000_000);
    expect(out.totalCostClp).toBe(5_000_000);
    expect(out.ratio).toBe(4);
  });

  it('respeta multiplier custom', () => {
    const out = applyHeinrichRatio(500_000, 6);
    expect(out.indirectCostClp).toBe(3_000_000);
    expect(out.totalCostClp).toBe(3_500_000);
  });

  it('clampa negativos a 0', () => {
    const out = applyHeinrichRatio(-1_000);
    expect(out.directCostClp).toBe(0);
    expect(out.totalCostClp).toBe(0);
  });
});

describe('compareToBenchmark (§179)', () => {
  it('marca better_than_industry cuando estamos >5% bajo', () => {
    const c = compareToBenchmark(900_000, 10, {
      industryAvgCostPerWorkerPerYearClp: 100_000,
      industryName: 'Construcción',
    });
    expect(c.ourCostPerWorkerPerYearClp).toBe(90_000);
    expect(c.verdict).toBe('better_than_industry');
  });

  it('marca on_par dentro de ±5%', () => {
    const c = compareToBenchmark(1_000_000, 10, {
      industryAvgCostPerWorkerPerYearClp: 100_000,
      industryName: 'Construcción',
    });
    expect(c.verdict).toBe('on_par');
  });

  it('marca worse_than_industry cuando estamos >5% sobre', () => {
    const c = compareToBenchmark(1_500_000, 10, {
      industryAvgCostPerWorkerPerYearClp: 100_000,
      industryName: 'Construcción',
    });
    expect(c.verdict).toBe('worse_than_industry');
    expect(c.deltaPct).toBeGreaterThan(5);
  });

  it('workersCount=0 retorna estructura segura', () => {
    const c = compareToBenchmark(1_000_000, 0, {
      industryAvgCostPerWorkerPerYearClp: 100_000,
      industryName: 'Construcción',
    });
    expect(c.ourCostPerWorkerPerYearClp).toBe(0);
    expect(c.verdict).toBe('on_par');
    expect(c.notes.some((n) => n.includes('workersCount'))).toBe(true);
  });
});
