import { describe, it, expect } from 'vitest';
import { generateGasDispersionNode } from './gasDispersionCloud';

describe('generateGasDispersionNode (DS 144/1961 / MINSAL ATSDR)', () => {
  it('returns high/critical node for sustained Cl₂ leak in stable atmosphere', () => {
    const node = generateGasDispersionNode(
      { id: 'leak-1', releaseRateKgS: 0.5, idlhMgM3: 30, relativeDensity: 2.5 }, // Cl2 IDLH 10 ppm ≈ 30 mg/m³
      { windKmh: 10, pasquillStability: 'F' },
      { id: 'campo', roughnessM: 0.05 },
    );
    expect(node).not.toBeNull();
    expect(['high', 'critical']).toContain(node?.severity);
  });

  it('returns null for tiny leak with strong wind dispersion', () => {
    const node = generateGasDispersionNode(
      { id: 'leak-2', releaseRateKgS: 0.00001, idlhMgM3: 100, relativeDensity: 1 },
      { windKmh: 60, pasquillStability: 'A' },
      { id: 'urb', roughnessM: 1.0 },
    );
    expect(node).toBeNull();
  });
});
