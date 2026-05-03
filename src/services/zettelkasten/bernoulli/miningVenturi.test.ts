import { describe, it, expect } from 'vitest';
import { generateMiningExtractionNode } from './miningVenturi';

describe('generateMiningExtractionNode (DS 594 Art. 32 / DS 132 Art. 75)', () => {
  it('returns critical node when CO sensor exceeds OEL even with adequate ACH', () => {
    const node = generateMiningExtractionNode(
      { id: 'tunel-3', volumeM3: 500, inletAreaM2: 4, throatAreaM2: 1, deltaPPa: 200 },
      { sensorId: 'co-12', measuredPpm: 60, oelPpm: 25 }, // CO OEL DS 594
    );
    expect(node).not.toBeNull();
    expect(node?.severity).toBe('critical');
  });

  it('returns null with healthy ventilation and sensor below OEL', () => {
    const node = generateMiningExtractionNode(
      { id: 'tunel-1', volumeM3: 200, inletAreaM2: 4, throatAreaM2: 1, deltaPPa: 500 },
      { sensorId: 'co-1', measuredPpm: 5, oelPpm: 25 },
    );
    expect(node).toBeNull();
  });
});
