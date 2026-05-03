import { describe, it, expect } from 'vitest';
import { generateMicroWindNode } from './microWindEnergy';

describe('generateMicroWindNode (IEC 61400-2)', () => {
  it('returns info node when funnel topo + 30 km/h wind covers BLE sensor budget', () => {
    const node = generateMicroWindNode(
      { id: 'paso-1', funnelFactor: 1.6, rotorAreaM2: 0.05 },
      { windKmh: 30 },
    );
    expect(node).not.toBeNull();
    expect(node?.severity).toBe('info');
  });

  it('returns null in calm air (5 km/h) for tiny rotor', () => {
    const node = generateMicroWindNode(
      { id: 'plano-1', funnelFactor: 1.0, rotorAreaM2: 0.01 },
      { windKmh: 5 },
    );
    expect(node).toBeNull();
  });
});
