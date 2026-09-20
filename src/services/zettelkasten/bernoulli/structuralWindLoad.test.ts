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

  // [Hy3-audit] Adversarial probes — non-finite inputs that previously
  // slipped past `<= 0` (IEEE 754 NaN comparisons are always false) and
  // produced a `riskNode` with `severity: 'high'` and `metadata: { forceN:
  // NaN, ratio: NaN, ... }`. The fix must reject non-finite inputs
  // BEFORE the math runs.
  it('rejects NaN inputs by throwing RangeError (does NOT return a node with NaN metadata)', () => {
    expect(() =>
      generateStructuralWindNode(
        { id: 'fac-X', areaM2: NaN, pressureCoefficient: 0.8 },
        { windKmh: 120 },
        { maxForceN: 5_000 },
      ),
    ).toThrow(RangeError);
  });

  it('rejects +Infinity wind speed', () => {
    expect(() =>
      generateStructuralWindNode(
        { id: 'fac-Y', areaM2: 30, pressureCoefficient: 0.8 },
        { windKmh: Infinity },
        { maxForceN: 5_000 },
      ),
    ).toThrow(/windKmh/);
  });

  it('rejects -Infinity max force limit', () => {
    expect(() =>
      generateStructuralWindNode(
        { id: 'fac-Z', areaM2: 30, pressureCoefficient: 0.8 },
        { windKmh: 120 },
        { maxForceN: -Infinity },
      ),
    ).toThrow(/maxForceN/);
  });

  it('rejects NaN pressureCoefficient', () => {
    expect(() =>
      generateStructuralWindNode(
        { id: 'fac-W', areaM2: 30, pressureCoefficient: NaN },
        { windKmh: 120 },
        { maxForceN: 5_000 },
      ),
    ).toThrow(/pressureCoefficient/);
  });
});
