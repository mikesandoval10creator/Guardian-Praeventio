// Praeventio Guard — pricingSimulator router contract tests.

import { describe, it, expect } from 'vitest';
import pricingSimulatorRouter from './pricingSimulator';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (pricingSimulatorRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('pricingSimulatorRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(pricingSimulatorRouter).toBeDefined();
    expect(typeof pricingSimulatorRouter).toBe('function');
  });

  it('registers POST /:projectId/pricing/estimate-bill', () => {
    expect(hasPost('/:projectId/pricing/estimate-bill')).toBe(true);
  });

  it('registers POST /:projectId/pricing/compare-tiers', () => {
    expect(hasPost('/:projectId/pricing/compare-tiers')).toBe(true);
  });

  it('registers POST /:projectId/pricing/worker-break-even', () => {
    expect(hasPost('/:projectId/pricing/worker-break-even')).toBe(true);
  });
});
