import { describe, it, expect } from 'vitest';
import {
  approximateWBGT,
  heatStressProtocol,
  computeWindChill,
  coldExtremeProtocol,
  checkAcclimatization,
  buildUvExposureReport,
} from './thermalStressCalculator.js';

describe('approximateWBGT', () => {
  it('día cálido moderado', () => {
    const wbgt = approximateWBGT(30, 60, 'medium');
    expect(wbgt).toBeGreaterThan(25);
    expect(wbgt).toBeLessThan(35);
  });

  it('día frío sin sol', () => {
    const wbgt = approximateWBGT(15, 50, 'none');
    expect(wbgt).toBeLessThan(15);
  });
});

describe('heatStressProtocol', () => {
  it('WBGT 24 + light → trabaja toda la hora', () => {
    const p = heatStressProtocol(24, 'light');
    expect(p.workMinutesPerHour).toBe(60);
    expect(p.stopWork).toBe(false);
  });

  it('WBGT 31 + moderate → 15 min trabajo', () => {
    const p = heatStressProtocol(31, 'moderate');
    expect(p.workMinutesPerHour).toBe(15);
    expect(p.restMinutesPerHour).toBe(45);
  });

  it('WBGT 33 + heavy → STOP', () => {
    const p = heatStressProtocol(33, 'heavy');
    expect(p.stopWork).toBe(true);
    expect(p.workMinutesPerHour).toBe(0);
  });

  it('hidratación >0 cuando se trabaja, 0 si stop', () => {
    const working = heatStressProtocol(26, 'moderate');
    const stopped = heatStressProtocol(35, 'very_heavy');
    expect(working.hydrationMlPerHour).toBeGreaterThan(0);
    expect(stopped.hydrationMlPerHour).toBe(0);
  });
});

describe('computeWindChill', () => {
  it('temperatura > 10°C → sin wind chill', () => {
    expect(computeWindChill(15, 10)).toBe(15);
  });

  it('-10°C + 20 m/s → sensación más fría', () => {
    const wc = computeWindChill(-10, 20);
    expect(wc).toBeLessThan(-10);
  });
});

describe('coldExtremeProtocol', () => {
  it('-30°C con viento fuerte → extreme + stop', () => {
    const p = coldExtremeProtocol(-30, 15);
    expect(p.riskLevel).toBe('extreme');
    expect(p.stopWork).toBe(true);
  });

  it('5°C ambiente → low', () => {
    const p = coldExtremeProtocol(5, 5);
    expect(p.riskLevel).toBe('low');
    expect(p.stopWork).toBe(false);
  });

  it('-15°C + viento moderado → high, no stop', () => {
    const p = coldExtremeProtocol(-15, 6);
    expect(p.riskLevel).toBe('high');
    expect(p.stopWork).toBe(false);
    expect(p.recommendations.length).toBeGreaterThan(0);
  });
});

describe('checkAcclimatization', () => {
  it('<2500m → siempre aclimatizado', () => {
    const r = checkAcclimatization('w1', 2000, 0);
    expect(r.isAcclimatized).toBe(true);
    expect(r.recommendedDaysToWait).toBe(0);
  });

  it('3000m sin tiempo previo → no aclimatizado', () => {
    const r = checkAcclimatization('w1', 3000, 0);
    expect(r.isAcclimatized).toBe(false);
    expect(r.recommendedDaysToWait).toBe(2);
  });

  it('4500m con 4 días → aún falta para el SLA de 7', () => {
    const r = checkAcclimatization('w1', 5000, 4);
    expect(r.isAcclimatized).toBe(false);
    expect(r.recommendedDaysToWait).toBe(3);
  });

  it('4500m con 7+ días → aclimatizado', () => {
    const r = checkAcclimatization('w1', 5000, 8);
    expect(r.isAcclimatized).toBe(true);
  });
});

describe('buildUvExposureReport', () => {
  it('día UV bajo', () => {
    const r = buildUvExposureReport([
      { hour: 9, uvIndex: 2 },
      { hour: 12, uvIndex: 3 },
      { hour: 15, uvIndex: 2 },
    ]);
    expect(r.riskLevel).toBe('low');
    expect(r.reprogramSuggested).toBe(false);
  });

  it('día UV extremo → reprogramar', () => {
    const r = buildUvExposureReport([
      { hour: 12, uvIndex: 12 },
      { hour: 14, uvIndex: 11 },
    ]);
    expect(r.riskLevel).toBe('extreme');
    expect(r.reprogramSuggested).toBe(true);
    expect(r.peakUvIndex).toBe(12);
  });

  it('SED acumulada alta → high', () => {
    const r = buildUvExposureReport(
      Array.from({ length: 6 }, (_, i) => ({ hour: 10 + i, uvIndex: 7 })),
    );
    expect(r.riskLevel === 'high' || r.riskLevel === 'extreme').toBe(true);
  });
});
