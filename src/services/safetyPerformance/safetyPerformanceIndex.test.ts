import { describe, it, expect } from 'vitest';
import {
  computeSafetyPerformance,
  buildSpiTrend,
  type LeadingIndicators,
  type LaggingIndicators,
} from './safetyPerformanceIndex.js';

const perfectLeading: LeadingIndicators = {
  preTaskChecklistCompletion: 1,
  dailyTalksDeliveryRate: 1,
  trainingCurrencyRate: 1,
  plannedInspectionsRate: 1,
  nearMissReportingRate: 15,
  positiveObservationsRate: 15,
};

const perfectLagging: LaggingIndicators = {
  trir: 0,
  ltifr: 0,
  lostDays: 0,
  severityRate: 0,
  regulatoryFindings: 0,
};

describe('computeSafetyPerformance', () => {
  it('todo perfecto → excellent (100)', () => {
    const r = computeSafetyPerformance(perfectLeading, perfectLagging);
    expect(r.spiScore).toBe(100);
    expect(r.level).toBe('excellent');
  });

  it('todo en cero → critical', () => {
    const r = computeSafetyPerformance(
      {
        preTaskChecklistCompletion: 0,
        dailyTalksDeliveryRate: 0,
        trainingCurrencyRate: 0,
        plannedInspectionsRate: 0,
        nearMissReportingRate: 0,
        positiveObservationsRate: 0,
      },
      {
        trir: 5,
        ltifr: 10,
        lostDays: 100,
        severityRate: 1000,
        regulatoryFindings: 10,
      },
    );
    expect(r.level).toBe('critical');
  });

  it('improvement focus identifica peor leading', () => {
    const r = computeSafetyPerformance(
      {
        ...perfectLeading,
        dailyTalksDeliveryRate: 0.2,
      },
      perfectLagging,
    );
    expect(r.improvementFocusAreas[0]).toMatch(/Charlas/i);
  });

  it('lagging pesa más que leading (60/40)', () => {
    // Perfecto leading + lagging malo
    const r1 = computeSafetyPerformance(perfectLeading, {
      trir: 5,
      ltifr: 10,
      lostDays: 100,
      severityRate: 1000,
      regulatoryFindings: 10,
    });
    // Malo leading + perfect lagging
    const r2 = computeSafetyPerformance(
      {
        preTaskChecklistCompletion: 0,
        dailyTalksDeliveryRate: 0,
        trainingCurrencyRate: 0,
        plannedInspectionsRate: 0,
        nearMissReportingRate: 0,
        positiveObservationsRate: 0,
      },
      perfectLagging,
    );
    expect(r2.spiScore).toBeGreaterThan(r1.spiScore); // lagging perfecto compensa más
  });
});

describe('buildSpiTrend', () => {
  it('improving si último > primero (>5%)', () => {
    const r = buildSpiTrend([
      { periodLabel: '2026-01', spiScore: 60 },
      { periodLabel: '2026-04', spiScore: 80 },
    ]);
    expect(r.trend).toBe('improving');
    expect(r.percentChange).toBe(33);
  });

  it('declining si último < primero (>5%)', () => {
    const r = buildSpiTrend([
      { periodLabel: '2026-01', spiScore: 80 },
      { periodLabel: '2026-04', spiScore: 60 },
    ]);
    expect(r.trend).toBe('declining');
  });

  it('stable si cambio <5%', () => {
    const r = buildSpiTrend([
      { periodLabel: '2026-01', spiScore: 80 },
      { periodLabel: '2026-04', spiScore: 82 },
    ]);
    expect(r.trend).toBe('stable');
  });

  it('vacío → stable, 0%', () => {
    const r = buildSpiTrend([]);
    expect(r.trend).toBe('stable');
    expect(r.percentChange).toBe(0);
  });
});
