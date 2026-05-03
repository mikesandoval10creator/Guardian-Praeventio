import { describe, it, expect } from 'vitest';
import { generateStructuralWindNode } from './structuralWindLoad';

describe('generateStructuralWindNode (NCh 432 Of.71)', () => {
  it('returns node when 120 km/h on 30 m² fachada exceeds 5 kN limit', () => {
    const node = generateStructuralWindNode(
      { id: 'fac-A', areaM2: 30, pressureCoefficient: 0.8 },
      { windKmh: 120 },
      { maxForceN: 5_000 },
    );
    expect(node).not.toBeNull();
    expect(node?.type).toBe('structural-wind');
  });

  it('returns null when 30 km/h is well below NCh 432 limit', () => {
    const node = generateStructuralWindNode(
      { id: 'fac-B', areaM2: 30, pressureCoefficient: 0.8 },
      { windKmh: 30 },
      { maxForceN: 50_000 },
    );
    expect(node).toBeNull();
  });
});
