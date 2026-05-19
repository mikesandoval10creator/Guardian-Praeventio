// Praeventio Guard — costCalculator router contract tests.

import { describe, it, expect } from 'vitest';
import costCalculatorRouter from './costCalculator';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (costCalculatorRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('costCalculatorRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(costCalculatorRouter).toBeDefined();
    expect(typeof costCalculatorRouter).toBe('function');
  });

  it('registers POST /:projectId/cost-calculator/non-compliance', () => {
    expect(hasPost('/:projectId/cost-calculator/non-compliance')).toBe(true);
  });

  it('registers POST /:projectId/cost-calculator/prevention-roi', () => {
    expect(hasPost('/:projectId/cost-calculator/prevention-roi')).toBe(true);
  });
});
