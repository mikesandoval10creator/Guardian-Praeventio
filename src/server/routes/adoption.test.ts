// Praeventio Guard — adoption router contract tests.

import { describe, it, expect } from 'vitest';
import adoptionRouter from './adoption';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (adoptionRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('adoptionRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(adoptionRouter).toBeDefined();
    expect(typeof adoptionRouter).toBe('function');
  });

  const paths = [
    '/:projectId/adoption/module-adoption',
    '/:projectId/adoption/funnel',
    '/:projectId/adoption/churn-risk',
    '/:projectId/adoption/first-value',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
