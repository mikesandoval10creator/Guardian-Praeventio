// Praeventio Guard — stoppage router contract tests.

import { describe, it, expect } from 'vitest';
import stoppageRouter from './stoppage';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (stoppageRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('stoppageRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(stoppageRouter).toBeDefined();
    expect(typeof stoppageRouter).toBe('function');
  });

  it.each([
    '/:projectId/stoppage/declare',
    '/:projectId/stoppage/mark-precondition-fulfilled',
    '/:projectId/stoppage/resume',
    '/:projectId/stoppage/cancel',
    '/:projectId/stoppage/summarize',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
