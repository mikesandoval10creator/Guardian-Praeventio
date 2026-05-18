// Praeventio Guard — pricingCalculator router contract tests.

import { describe, it, expect } from 'vitest';
import pricingCalculatorRouter from './pricingCalculator';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (pricingCalculatorRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('pricingCalculatorRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(pricingCalculatorRouter).toBeDefined();
    expect(typeof pricingCalculatorRouter).toBe('function');
  });

  const paths = [
    '/:projectId/pricing-calculator/estimate-tier-cost',
    '/:projectId/pricing-calculator/compare-tiers',
    '/:projectId/pricing-calculator/compute-roi',
    '/:projectId/pricing-calculator/suggest-purchase-orders',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
