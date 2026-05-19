// Praeventio Guard — exceptions router contract tests.

import { describe, it, expect } from 'vitest';
import exceptionsRouter from './exceptions';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (exceptionsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('exceptionsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(exceptionsRouter).toBeDefined();
    expect(typeof exceptionsRouter).toBe('function');
  });

  const paths = [
    '/:projectId/exceptions/create',
    '/:projectId/exceptions/derive-status',
    '/:projectId/exceptions/revoke',
    '/:projectId/exceptions/mark-fulfilled',
    '/:projectId/exceptions/filter-active-at',
    '/:projectId/exceptions/summarize',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
