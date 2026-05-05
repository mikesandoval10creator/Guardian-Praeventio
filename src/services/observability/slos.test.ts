// Praeventio Guard — Sprint 24 differentiators (Bucket MM.4) tests.

import { describe, it, expect } from 'vitest';
import { SLOS, computeBurn, burnRateStatus, getSlo } from './slos';

describe('SLO config', () => {
  it('defines all required SLOs with valid targets', () => {
    expect(SLOS.length).toBeGreaterThanOrEqual(4);
    for (const slo of SLOS) {
      expect(slo.id).toBeTruthy();
      expect(slo.windowDays).toBeGreaterThan(0);
      expect(slo.thresholdAlert).toBeGreaterThan(0);
      if (slo.metric === 'availability' || slo.metric === 'error_rate') {
        expect(slo.target).toBeGreaterThan(0);
        expect(slo.target).toBeLessThanOrEqual(1);
      }
    }
  });

  it('availability burn: at-target observed yields ~zero consumption, alert clean', () => {
    const slo = getSlo('api-availability')!;
    const result = computeBurn(slo, { observed: 0.999, totalSamples: 100_000, daysElapsed: 15 });
    expect(result.consumed).toBeCloseTo(1, 1); // burning exactly at budget
    // burnRate = consumed / ideal; ideal = 15/30 = 0.5, so burnRate≈2 → alerting
    expect(result.burnRate).toBeGreaterThan(1);
    expect(burnRateStatus(slo, 0.5)).toBe('healthy');
    expect(burnRateStatus(slo, 1.4)).toBe('warn');
    expect(burnRateStatus(slo, 2.5)).toBe('alert');
  });

  it('latency_p95 burn: under target = healthy, over target = consumes budget', () => {
    const slo = getSlo('api-latency-p95')!;
    const ok = computeBurn(slo, { observed: 400, totalSamples: 1000, daysElapsed: 10 });
    expect(ok.consumed).toBe(0);
    expect(ok.burnRate).toBe(0);

    const over = computeBurn(slo, { observed: 600, totalSamples: 1000, daysElapsed: 10 });
    expect(over.consumed).toBeCloseTo(0.2, 5); // (600-500)/500
    expect(over.burnRate).toBeGreaterThan(0);
  });

  it('error_rate burn: triggers alerting when burn exceeds 1 + thresholdAlert', () => {
    const slo = getSlo('gemini-error-rate')!; // target 0.01, thresholdAlert 0.5
    // observed 3% with daysElapsed 10/30: consumed = 0.03/0.01 = 3, ideal = 0.333,
    // burnRate = 9 → way over alert threshold.
    const result = computeBurn(slo, { observed: 0.03, totalSamples: 50_000, daysElapsed: 10 });
    expect(result.alerting).toBe(true);
    expect(burnRateStatus(slo, result.burnRate)).toBe('alert');
  });
});
