import { describe, it, expect } from 'vitest';
import { generateGasLeakNode } from './gasLeakDetection';

describe('generateGasLeakNode (ANSI/API 1109)', () => {
  it('returns critical node when ΔE excess > 50% of expected friction loss', () => {
    const node = generateGasLeakNode(
      { id: 'pa', pressurePa: 500_000, velocityMs: 3, heightM: 0 },
      { id: 'pb', pressurePa: 100_000, velocityMs: 3, heightM: 0 }, // huge drop
      { id: 'GLP', densityKgM3: 2.0, expectedFrictionLossJKg: 5000, lelVolPercent: 1.8 },
    );
    expect(node).not.toBeNull();
    expect(node?.type).toBe('gas-leak-anomaly');
    expect(node?.severity).toBe('critical');
  });

  it('returns null when observed ΔE ≈ expected friction (within 15% tolerance)', () => {
    const node = generateGasLeakNode(
      { id: 'pa', pressurePa: 500_000, velocityMs: 3, heightM: 0 },
      { id: 'pb', pressurePa: 489_000, velocityMs: 3, heightM: 0 }, // ΔE ≈ 5500 J/kg
      { id: 'GLP', densityKgM3: 2.0, expectedFrictionLossJKg: 5000, lelVolPercent: 1.8 },
    );
    expect(node).toBeNull();
  });
});
