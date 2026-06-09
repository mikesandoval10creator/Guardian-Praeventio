// SPDX-License-Identifier: MIT
// Real-engine test: structural-load inputs × wind forecast -> GeneratorProbe,
// and the END-TO-END firing path through the REAL scheduler at the CORRECT
// cadence (the time-scale fix the prior blueprint missed).
import { describe, it, expect } from 'vitest';
import {
  buildStructuralLoadProbe,
  buildStructuralLoadProbes,
  deriveSchedulerWindow,
  FORECAST_MINUTES_PER_STEP,
  type StructuralLoadInputs,
} from './structuralLoadProbe';
import { windLoadOnSurface, windSpeedKmhToMs } from '../physics/bernoulliEngine';
import { evaluateProbes } from './alertScheduler';

const RHO = 1.225;
const base: StructuralLoadInputs = {
  id: 'wall-1',
  areaM2: 20,
  pressureCoefficient: 0.8,
  maxForceN: 5000,
};

function forceFor(windKmh: number, inputs: StructuralLoadInputs = base): number {
  return windLoadOnSurface(
    inputs.areaM2,
    windSpeedKmhToMs(windKmh),
    Math.abs(inputs.pressureCoefficient),
    RHO,
  );
}

describe('buildStructuralLoadProbe (real Bernoulli)', () => {
  it('computes currentValue as the real wind force F=Cp·½ρv²·A', () => {
    const probe = buildStructuralLoadProbe(base, 60, [60, 80, 100]);
    expect(probe).not.toBeNull();
    expect(probe!.currentValue).toBeCloseTo(forceFor(60), 6);
    expect(probe!.threshold).toBe(base.maxForceN);
    expect(probe!.id).toBe('structural-wind');
  });

  it('forecast(m) is a STEP function over REAL minute offsets, not a sample index', () => {
    // Hourly winds at +60, +120, +180 min. minutesPerStep = 60.
    const winds = [40, 70, 110];
    const probe = buildStructuralLoadProbe(base, 40, winds)!;
    // Minute 1..60 -> sample 0 (the +1h prediction).
    expect(probe.forecast(1)).toBeCloseTo(forceFor(40), 6);
    expect(probe.forecast(60)).toBeCloseTo(forceFor(40), 6);
    // Minute 61..120 -> sample 1 (+2h).
    expect(probe.forecast(61)).toBeCloseTo(forceFor(70), 6);
    expect(probe.forecast(120)).toBeCloseTo(forceFor(70), 6);
    // Minute 121..180 -> sample 2 (+3h).
    expect(probe.forecast(180)).toBeCloseTo(forceFor(110), 6);
    // Out of range.
    expect(Number.isNaN(probe.forecast(0))).toBe(true);
    expect(Number.isNaN(probe.forecast(181))).toBe(true);
  });

  it('uses |Cp| so suction (negative Cp) still yields a positive force', () => {
    const suction = { ...base, pressureCoefficient: -1.5 };
    const probe = buildStructuralLoadProbe(suction, 50, [50])!;
    expect(probe.currentValue).toBeGreaterThan(0);
  });

  it('returns null for missing/invalid inputs — NO fabricated probe', () => {
    expect(buildStructuralLoadProbe({ ...base, areaM2: 0 }, 60, [60])).toBeNull();
    expect(buildStructuralLoadProbe({ ...base, maxForceN: -1 }, 60, [60])).toBeNull();
    expect(buildStructuralLoadProbe({ ...base, pressureCoefficient: 0 }, 60, [60])).toBeNull();
    expect(buildStructuralLoadProbe({ ...base, areaM2: NaN }, 60, [60])).toBeNull();
  });

  it('returns null when the forecast has no usable wind samples (honest no-probe)', () => {
    expect(buildStructuralLoadProbe(base, 60, [])).toBeNull();
    expect(buildStructuralLoadProbe(base, 60, [NaN, -5])).toBeNull();
  });

  it('buildStructuralLoadProbes drops invalid records, keeps real ones', () => {
    const recs: StructuralLoadInputs[] = [
      base,
      { ...base, id: 'bad', areaM2: 0 },
      { ...base, id: 'wall-2', areaM2: 10 },
    ];
    const probes = buildStructuralLoadProbes(recs, 60, [60, 90]);
    expect(probes).toHaveLength(2);
    expect(probes.every((p) => p.id === 'structural-wind')).toBe(true);
  });
});

describe('deriveSchedulerWindow (cadence agreement)', () => {
  it('spans the full hourly forecast with one-step lead time', () => {
    const w = deriveSchedulerWindow(6); // 6 hourly samples
    expect(w).toEqual({ windowMinutes: 360, minLeadTimeMin: 60 });
  });
  it('returns null for an empty forecast', () => {
    expect(deriveSchedulerWindow(0)).toBeNull();
  });
});

describe('END-TO-END firing through the REAL scheduler (time-scale fix)', () => {
  // This is the test the prior blueprint was missing. It drives the actual
  // evaluateProbes with the DERIVED window. Under the rejected "sample i ->
  // minute i" mapping a 3-sample forecast could never reach minLeadTime 5, so
  // it would RED. With the real minute mapping (hourly = 60-min steps) it fires.

  it('real high-wind hourly forecast crosses threshold AND fires an alert', () => {
    // +1h=30, +2h=60, +3h=110 km/h on 20 m² wall, Cp 0.8.
    const forecast = [30, 60, 110];
    const probe = buildStructuralLoadProbe(base, 25, forecast)!;
    // Force at 110 km/h is well above the 5 kN limit; at 30 it is below.
    expect(forceFor(110)).toBeGreaterThan(base.maxForceN);
    expect(forceFor(30)).toBeLessThan(base.maxForceN);

    const window = deriveSchedulerWindow(forecast.length)!;
    const alerts = evaluateProbes({
      probes: [probe],
      windowMinutes: window.windowMinutes,
      minLeadTimeMin: window.minLeadTimeMin,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].generatorId).toBe('structural-wind');
    // The crossing is at the +3h sample → minute 121..180. leadTimeMin is the
    // TRUE horizon in minutes (>= 121), NOT a raw sample index of 3.
    expect(alerts[0].decision.leadTimeMin).toBeGreaterThanOrEqual(121);
    expect(alerts[0].decision.leadTimeMin).toBeLessThanOrEqual(180);
  });

  it('would NOT fire if the daily-index mapping were used (regression guard)', () => {
    // Prove the OLD mapping is dead: treat sample index as minute (window 15,
    // minLeadTime 5 — the pre-fix mount config). The crossing is at index 3,
    // i.e. "minute 3" < minLeadTime 5 → zero alerts (the dead ladder).
    const forecast = [30, 60, 110];
    const indexProbe = {
      id: 'structural-wind',
      threshold: base.maxForceN,
      currentValue: forceFor(25),
      // index-as-minute (the bug): forecast(m) = sample m-1.
      forecast: (m: number) =>
        m >= 1 && m <= forecast.length ? forceFor(forecast[m - 1]) : Number.NaN,
    };
    const alerts = evaluateProbes({ probes: [indexProbe], minLeadTimeMin: 5 });
    expect(alerts).toHaveLength(0);
  });

  it('no forecast => no probe => no alert (honest silence)', () => {
    const probe = buildStructuralLoadProbe(base, 25, []);
    expect(probe).toBeNull();
    const alerts = evaluateProbes({ probes: probe ? [probe] : [] });
    expect(alerts).toHaveLength(0);
  });

  it('FORECAST_MINUTES_PER_STEP is the hourly cadence (60 min)', () => {
    expect(FORECAST_MINUTES_PER_STEP).toBe(60);
  });
});
