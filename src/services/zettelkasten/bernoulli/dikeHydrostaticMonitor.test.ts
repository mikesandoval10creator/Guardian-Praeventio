import { describe, it, expect } from 'vitest';
import { generateDikeNode } from './dikeHydrostaticMonitor';

describe('generateDikeNode (DS 248/2007 / SERNAGEOMIN Res. 1500)', () => {
  it('returns critical node when piezometer reads ≥ 30% below expected ρgh', () => {
    // expected ρgh @ 10 m, ρ=1500 → 147 kPa. Anomaly < 100 kPa.
    const node = generateDikeNode(
      { id: 'tranque-A', heightM: 30, fluidDensityKgM3: 1500 },
      [
        { id: 'pz-1', depthM: 10, measuredPressurePa: 80_000 },
        { id: 'pz-2', depthM: 10, measuredPressurePa: 145_000 },
      ],
    );
    expect(node).not.toBeNull();
    expect(node?.severity).toBe('critical');
    expect(node?.metadata.worstSensorId).toBe('pz-1');
  });

  it('returns null when all piezometers within ±15% of expected hydrostatic', () => {
    const node = generateDikeNode(
      { id: 'tranque-B', heightM: 30, fluidDensityKgM3: 1500 },
      [
        { id: 'pz-1', depthM: 10, measuredPressurePa: 145_000 },
        { id: 'pz-2', depthM: 5, measuredPressurePa: 72_000 },
      ],
    );
    expect(node).toBeNull();
  });
});
