import { describe, it, expect } from 'vitest';
import { generateRespiratorFatigueNode } from './respiratorFatigue';

describe('generateRespiratorFatigueNode (NIOSH 42 CFR Part 84)', () => {
  it('returns node when high flow (workload) exceeds N95 max drop', () => {
    const node = generateRespiratorFatigueNode(
      { id: 'w-1', breathingFlowM3S: 0.002 }, // heavy workload
      { id: 'n95-A', filterResistancePaSPerM3: 800, maxPressureDropPa: 1.0 },
      { temperatureC: 35 },
    );
    // Δp = 800 * 0.002 * 1.2 = 1.92 Pa > 1.0
    expect(node).not.toBeNull();
    expect(node?.type).toBe('respirator-fatigue');
  });

  it('returns null at resting flow well within NIOSH limit', () => {
    const node = generateRespiratorFatigueNode(
      { id: 'w-2', breathingFlowM3S: 0.001 },
      { id: 'n95-B', filterResistancePaSPerM3: 800, maxPressureDropPa: 343 },
      { temperatureC: 22 },
    );
    expect(node).toBeNull();
  });
});
