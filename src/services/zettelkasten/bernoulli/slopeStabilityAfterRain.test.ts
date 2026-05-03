import { describe, it, expect } from 'vitest';
import { generateSlopeStabilityNode } from './slopeStabilityAfterRain';

describe('generateSlopeStabilityNode (DS 132 Art. 32 / Eurocódigo 7)', () => {
  it('returns critical node when slope > saturated repose AND hydrostatic > 50 kPa', () => {
    const node = generateSlopeStabilityNode(
      { id: 'arena', dryReposeAngleRad: 0.61, saturationReductionRad: 0.15 }, // 35° → 26.5°
      { id: 'talud-1', slopeAngleRad: Math.PI / 6 + 0.1, heightM: 10 }, // ~36°
      { waterTableDepthM: 1, waterDensityKgM3: 1000 }, // ρgh = 88 kPa @ 9 m submerged
    );
    expect(node).not.toBeNull();
    expect(node?.severity).toBe('critical');
  });

  it('returns null on a gentle dry slope', () => {
    const node = generateSlopeStabilityNode(
      { id: 'arena', dryReposeAngleRad: 0.61, saturationReductionRad: 0.05 },
      { id: 'talud-2', slopeAngleRad: 0.2, heightM: 3 },
      { waterTableDepthM: 10, waterDensityKgM3: 1000 },
    );
    expect(node).toBeNull();
  });
});
