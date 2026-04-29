// Round 15 / I4 — UV index pure helpers (Ley 20.096).

import { describe, expect, it } from 'vitest';
import { computeUvIndex, uvRiskBand } from './SunTracker';

describe('computeUvIndex', () => {
  it('returns 0 at night (sun below horizon)', () => {
    // Santiago, Dec solstice, midnight
    expect(computeUvIndex(-33.45, 355, 0, 0)).toBe(0);
  });

  it('returns 0 at sunrise/sunset boundary', () => {
    // very steep angle, e.g. 5am in winter
    const uv = computeUvIndex(-33.45, 172, 5, 0);
    expect(uv).toBe(0);
  });

  it('returns positive UV at solar noon (clear sky, equator-ish)', () => {
    // Equator near equinox
    const uv = computeUvIndex(0, 81, 12, 0);
    expect(uv).toBeGreaterThan(8);
    expect(uv).toBeLessThan(15);
  });

  it('cloud cover reduces UV by up to 50% at full overcast (within ±1 due to rounding)', () => {
    const clear = computeUvIndex(0, 81, 12, 0);
    const overcast = computeUvIndex(0, 81, 12, 100);
    // Both clear and overcast are rounded independently, so the relation
    // round(clear*0.5) is approximate. Allow ±1 lux.
    expect(Math.abs(overcast - Math.round(clear * 0.5))).toBeLessThanOrEqual(1);
    expect(overcast).toBeLessThan(clear);
  });

  it('Santiago summer noon yields high but not extreme UV', () => {
    // -33.45 lat, Dec 21 (~doy 355), noon, no clouds
    const uv = computeUvIndex(-33.45, 355, 12, 0);
    expect(uv).toBeGreaterThan(8);
  });

  it('clamps cloud cover above 100', () => {
    const a = computeUvIndex(0, 81, 12, 100);
    const b = computeUvIndex(0, 81, 12, 9999);
    expect(a).toBe(b);
  });

  it('clamps cloud cover below 0', () => {
    const a = computeUvIndex(0, 81, 12, 0);
    const b = computeUvIndex(0, 81, 12, -50);
    expect(a).toBe(b);
  });
});

describe('uvRiskBand', () => {
  it('classifies UV 0-2 as Bajo', () => {
    expect(uvRiskBand(0).level).toBe('Bajo');
    expect(uvRiskBand(2).level).toBe('Bajo');
  });

  it('classifies UV 3-5 as Moderado', () => {
    expect(uvRiskBand(3).level).toBe('Moderado');
    expect(uvRiskBand(5).level).toBe('Moderado');
  });

  it('classifies UV 6-7 as Alto', () => {
    expect(uvRiskBand(6).level).toBe('Alto');
    expect(uvRiskBand(7).level).toBe('Alto');
  });

  it('classifies UV 8-10 as Muy Alto', () => {
    expect(uvRiskBand(10).level).toBe('Muy Alto');
  });

  it('classifies UV 11+ as Extremo', () => {
    expect(uvRiskBand(11).level).toBe('Extremo');
    expect(uvRiskBand(15).level).toBe('Extremo');
  });
});
