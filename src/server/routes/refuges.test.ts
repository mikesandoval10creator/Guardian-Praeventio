// Praeventio Guard — refuges router contract tests.

import { describe, it, expect } from 'vitest';
import refugesRouter from './refuges';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (refugesRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('refugesRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(refugesRouter).toBeDefined();
    expect(typeof refugesRouter).toBe('function');
  });

  it.each([
    '/:projectId/refuges/list-catalog',
    '/:projectId/refuges/find-nearest',
    '/:projectId/refuges/availability',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
