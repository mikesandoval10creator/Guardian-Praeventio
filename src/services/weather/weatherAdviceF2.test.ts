import { describe, it, expect } from 'vitest';
import { weatherAdvice } from './weatherAdvice';

describe('weatherAdvice (F2 simple API)', () => {
  it('no-risk conditions → only baseline message', () => {
    const result = weatherAdvice({ tempC: 20, uv: 3, windKmh: 15 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('baseline');
    expect(result[0].tone).toBe('info');
  });

  it('heat >= 30°C → hydration advisory + baseline', () => {
    const result = weatherAdvice({ tempC: 32, uv: 3, windKmh: 10 });
    const ids = result.map((a) => a.id);
    expect(ids).toContain('heat');
    expect(ids).toContain('baseline');
    expect(result.find((a) => a.id === 'heat')!.tone).toBe('warning');
  });

  it('cold <= 2°C → cold advisory', () => {
    const result = weatherAdvice({ tempC: 1, uv: 0, windKmh: 5 });
    expect(result.map((a) => a.id)).toContain('cold');
  });

  it('snow condition code → cold advisory', () => {
    const result = weatherAdvice({ tempC: 5, uv: 0, windKmh: 10, code: 601 });
    expect(result.map((a) => a.id)).toContain('cold');
  });

  it('wind >= 40 km/h → hazard advisory', () => {
    const result = weatherAdvice({ tempC: 20, uv: 3, windKmh: 45 });
    const wind = result.find((a) => a.id === 'wind');
    expect(wind).toBeDefined();
    expect(wind!.tone).toBe('hazard');
  });

  it('UV >= 6 → uv advisory', () => {
    const result = weatherAdvice({ tempC: 25, uv: 8, windKmh: 10 });
    expect(result.map((a) => a.id)).toContain('uv');
  });

  it('multiple risks → multiple advisories + baseline', () => {
    const result = weatherAdvice({ tempC: 35, uv: 9, windKmh: 50 });
    const ids = result.map((a) => a.id);
    expect(ids).toContain('heat');
    expect(ids).toContain('uv');
    expect(ids).toContain('wind');
    expect(ids).toContain('baseline');
  });
});
