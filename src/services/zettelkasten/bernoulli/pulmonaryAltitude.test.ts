import { describe, it, expect } from 'vitest';
import { generatePulmonaryNode } from './pulmonaryAltitude';

describe('generatePulmonaryNode (DS 594 Art. 49)', () => {
  it('returns node at 4500 msnm with PEF=300 L/min and tight critical drop', () => {
    const node = generatePulmonaryNode(
      { id: 'w-1', pefLMin: 300 },
      { masl: 4500 },
      { id: 'mask-A', filterResistancePaSPerM3: 800, criticalDropPa: 5 },
    );
    expect(node).not.toBeNull();
    expect(node?.severity).toBe('high');
  });

  it('returns null at sea level with healthy adult PEF=600 L/min', () => {
    const node = generatePulmonaryNode(
      { id: 'w-2', pefLMin: 600 },
      { masl: 50 },
      { id: 'mask-B', filterResistancePaSPerM3: 800, criticalDropPa: 100 },
    );
    expect(node).toBeNull();
  });
});
