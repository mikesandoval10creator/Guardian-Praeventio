import { describe, it, expect } from 'vitest';
import {
  dynamicPressure,
  staticPressureDelta,
  venturiFlowRate,
  windLoadOnSurface,
  respiratorPressureDrop,
  windSpeedKmhToMs,
} from './bernoulliEngine';

describe('bernoulliEngine', () => {
  it('dynamicPressure: 1.225 kg/m³ at 10 m/s ≈ 61.25 Pa', () => {
    expect(dynamicPressure(1.225, 10)).toBeCloseTo(61.25, 2);
  });

  it('staticPressureDelta: 1.225 kg/m³ from 5 to 10 m/s ≈ 45.94 Pa', () => {
    expect(staticPressureDelta(1.225, 5, 10)).toBeCloseTo(45.94, 2);
  });

  it('venturiFlowRate: produces a positive finite number for valid inputs', () => {
    const q = venturiFlowRate(0.01, 0.005, 100, 1000);
    expect(Number.isFinite(q)).toBe(true);
    expect(q).toBeGreaterThan(0);
  });

  it('venturiFlowRate: throws when A1 = A2', () => {
    expect(() => venturiFlowRate(0.01, 0.01, 100, 1000)).toThrow();
  });

  it('venturiFlowRate: throws on negative deltaP', () => {
    expect(() => venturiFlowRate(0.01, 0.005, -10, 1000)).toThrow();
  });

  it('dynamicPressure: zero velocity yields 0', () => {
    expect(dynamicPressure(1.225, 0)).toBe(0);
  });

  it('windLoadOnSurface: 20 m², 25 m/s, Cp 0.8 ≈ 6125 N', () => {
    expect(windLoadOnSurface(20, 25, 0.8)).toBeCloseTo(6125, 0);
  });

  it('respiratorPressureDrop: 800 Pa·s/m³ at 0.001 m³/s ≈ 0.8 Pa', () => {
    expect(respiratorPressureDrop(800, 0.001)).toBeCloseTo(0.8, 6);
  });

  it('windSpeedKmhToMs: 36 km/h === 10 m/s', () => {
    expect(windSpeedKmhToMs(36)).toBe(10);
  });

  // DS 594 Art. 35 — ACH = Q · 3600 / volume; min 12 for chemical storage.
  describe('ACH derived from Venturi (DS 594 Art. 35)', () => {
    const rhoAir = 1.225;

    it('large Venturi (A1=0.4, A2=0.1, ΔP=200 Pa) clears 12 ACH for a 150 m³ room', () => {
      const q = venturiFlowRate(0.4, 0.1, 200, rhoAir);
      const ach = (q * 3600) / 150;
      expect(ach).toBeGreaterThan(12);
    });

    it('tiny throat (A2=0.005 m²) fails 12 ACH minimum for a 150 m³ room', () => {
      const q = venturiFlowRate(0.4, 0.005, 50, rhoAir);
      const ach = (q * 3600) / 150;
      expect(ach).toBeLessThan(12);
    });

    it('ACH scales linearly with 1/volume for fixed Q', () => {
      const q = venturiFlowRate(0.4, 0.1, 50, rhoAir);
      const ach100 = (q * 3600) / 100;
      const ach200 = (q * 3600) / 200;
      expect(ach100 / ach200).toBeCloseTo(2, 6);
    });
  });
});
