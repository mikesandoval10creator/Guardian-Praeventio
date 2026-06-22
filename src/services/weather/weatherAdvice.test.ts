// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getWeatherAdvice } from './weatherAdvice';

describe('getWeatherAdvice', () => {
  it('returns at least one advisory always', () => {
    const result = getWeatherAdvice({});
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('returns motivational blue advisory when conditions are fine', () => {
    const result = getWeatherAdvice({ temp: 20, windSpeed: 10, uv: 3, isDaytime: true });
    expect(result.length).toBe(1);
    expect(result[0].level).toBe('blue');
    expect(result[0].icon).toBe('✅');
  });

  it('flags heat when temp > 30', () => {
    const result = getWeatherAdvice({ temp: 35 });
    const heat = result.find(a => a.icon === '🌡️');
    expect(heat).toBeDefined();
    expect(heat?.level).toBe('red');
  });

  it('flags high UV >= 6 as amber', () => {
    const result = getWeatherAdvice({ uv: 8, temp: 25 });
    const uvAdv = result.find(a => a.icon === '☀️');
    expect(uvAdv).toBeDefined();
    expect(uvAdv?.level).toBe('amber');
  });

  it('flags strong wind > 40 as red', () => {
    const result = getWeatherAdvice({ windSpeed: 55 });
    const windAdv = result.find(a => a.icon === '🌬️');
    expect(windAdv).toBeDefined();
    expect(windAdv?.level).toBe('red');
  });

  it('flags rain condition', () => {
    const result = getWeatherAdvice({ condition: 'Lluvia moderada' });
    const rainAdv = result.find(a => a.icon === '⚠️');
    expect(rainAdv).toBeDefined();
    expect(rainAdv?.level).toBe('red');
  });

  it('flags snow/ice/frost as red (cold + slip)', () => {
    const result = getWeatherAdvice({ condition: 'Nieve ligera', temp: 2 });
    const cold = result.find(a => a.icon === '🧊');
    expect(cold).toBeDefined();
    expect(cold?.level).toBe('red');
  });

  it('flags night work as blue', () => {
    const result = getWeatherAdvice({ isDaytime: false, temp: 20 });
    const night = result.find(a => a.icon === '🔦');
    expect(night).toBeDefined();
    expect(night?.level).toBe('blue');
  });

  it('caps output at 3 advisories max', () => {
    // Many bad conditions
    const result = getWeatherAdvice({
      temp: 38, windSpeed: 60, condition: 'lluvia', uv: 10, aqi: 5, isDaytime: false
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('orders red before amber before blue', () => {
    const result = getWeatherAdvice({ temp: 35, uv: 8, isDaytime: false });
    const levels = result.map(a => a.level);
    // No blue should appear before amber, no amber before red
    const redIdx  = levels.lastIndexOf('red');
    const amberIdx = levels.indexOf('amber');
    const blueIdx  = levels.indexOf('blue');
    if (redIdx >= 0 && amberIdx >= 0) expect(redIdx).toBeLessThan(amberIdx);
    if (amberIdx >= 0 && blueIdx >= 0) expect(amberIdx).toBeLessThan(blueIdx);
    if (redIdx >= 0 && blueIdx >= 0) expect(redIdx).toBeLessThan(blueIdx);
  });

  it('uses aqi numeric field >= 4 to flag poor air quality', () => {
    const result = getWeatherAdvice({ aqi: 4, temp: 22 });
    const aq = result.find(a => a.icon === '🚶');
    expect(aq).toBeDefined();
    expect(aq?.level).toBe('amber');
  });
});
