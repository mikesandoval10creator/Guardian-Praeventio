import { describe, it, expect } from 'vitest';
import { generateHidrantePressureNode } from './hidranteFireNetwork';

describe('generateHidrantePressureNode (NCh 1646 / NFPA 14)', () => {
  it('returns critical node when network pressure is below NCh 1646 minimum (2 bar)', () => {
    const node = generateHidrantePressureNode(
      { id: 'red-A', networkPressurePa: 150_000, nozzleDiameterM: 0.038, dischargeCoefficient: 0.95 },
      { id: 't-12', reachHeightM: 12, jetAngleRad: Math.PI / 2 },
      { ambientPressurePa: 101_325 },
    );
    expect(node).not.toBeNull();
    expect(node?.type).toBe('hidrante-pressure');
    expect(['high', 'critical']).toContain(node?.severity);
  });

  it('returns null when 4 bar network easily reaches 12 m vertical (NFPA 14 baseline)', () => {
    const node = generateHidrantePressureNode(
      { id: 'red-B', networkPressurePa: 500_000, nozzleDiameterM: 0.038, dischargeCoefficient: 0.95 },
      { id: 't-1', reachHeightM: 5, jetAngleRad: Math.PI / 2 },
      { ambientPressurePa: 101_325 },
    );
    expect(node).toBeNull();
  });
});
