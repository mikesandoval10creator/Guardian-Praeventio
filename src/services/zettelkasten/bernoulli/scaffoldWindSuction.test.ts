import { describe, it, expect } from 'vitest';
import { generateScaffoldUpliftNode } from './scaffoldWindSuction';

describe('generateScaffoldUpliftNode (NCh 432 / OSHA 1926.451)', () => {
  it('returns critical node when 90 km/h wind on 50 m² lona overcomes 4×1 kN anchors', () => {
    const node = generateScaffoldUpliftNode(
      { id: 'sc-7', areaM2: 50, pressureCoefficient: -1.5 },
      { windKmh: 90 },
      { ratedCapacityN: 1000, anchorCount: 4 },
    );
    expect(node).not.toBeNull();
    expect(node?.type).toBe('scaffold-uplift');
    expect(node?.severity).toBe('critical');
  });

  it('returns null when light breeze (20 km/h) does not exceed anchor capacity', () => {
    const node = generateScaffoldUpliftNode(
      { id: 'sc-1', areaM2: 50, pressureCoefficient: -1.0 },
      { windKmh: 20 },
      { ratedCapacityN: 5000, anchorCount: 4 },
    );
    expect(node).toBeNull();
  });
});
