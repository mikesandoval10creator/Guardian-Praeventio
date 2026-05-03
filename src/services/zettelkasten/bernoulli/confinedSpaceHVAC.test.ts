import { describe, it, expect } from 'vitest';
import { generateConfinedSpaceVentNode } from './confinedSpaceHVAC';

describe('generateConfinedSpaceVentNode (DS 594 Art. 35 / 61, OSHA 1910.146)', () => {
  it('returns node when ACH < 6 (DS 594 minimum) for H2S-laden space', () => {
    const node = generateConfinedSpaceVentNode(
      { id: 'cs-1', volumeM3: 100, contaminantRelDensity: 1.19 }, // H2S
      { extractionVelocityMs: 5, intakeVelocityMs: 1, flowRateM3S: 0.05 }, // 1.8 ACH
      { measuredDeltaPPa: 18 },
    );
    expect(node).not.toBeNull();
    expect(node?.metadata.achOk).toBe(false);
  });

  it('returns null when ACH ≥ 6, gradient positive, and sensor within 20% tolerance', () => {
    const node = generateConfinedSpaceVentNode(
      { id: 'cs-2', volumeM3: 100, contaminantRelDensity: 1.19 },
      { extractionVelocityMs: 5, intakeVelocityMs: 1, flowRateM3S: 0.5 }, // 18 ACH
      { measuredDeltaPPa: 17 }, // ½·1.46·(25-1) = 17.5 Pa
    );
    expect(node).toBeNull();
  });
});
