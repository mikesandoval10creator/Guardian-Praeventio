import { describe, it, expect } from 'vitest';
import { generateHazmatPipeNode } from './hazmatPipePressure';

describe('generateHazmatPipeNode (DS 43/2015 / NFPA 30)', () => {
  it('returns critical node when downstream pressure ≤ vapor pressure (cavitation)', () => {
    // Acceleration v 1→20 m/s in benzene (ρ=876, Pv=10 kPa @ 20°C) at 1 atm pump head.
    const node = generateHazmatPipeNode(
      { id: 'p1', velocityInMs: 1, velocityOutMs: 20, heightDeltaM: 0 },
      { id: 'benceno', densityKgM3: 876, vaporPressurePa: 10_000 },
      { upstreamPressurePa: 101_325 },
    );
    expect(node).not.toBeNull();
    expect(node?.metadata.cavitates).toBe(true);
  });

  it('returns null for low-velocity water pipe at 5 bar pump head', () => {
    const node = generateHazmatPipeNode(
      { id: 'p2', velocityInMs: 1, velocityOutMs: 1.5, heightDeltaM: 2 },
      { id: 'agua', densityKgM3: 1000, vaporPressurePa: 2_339 },
      { upstreamPressurePa: 500_000 },
    );
    expect(node).toBeNull();
  });
});
