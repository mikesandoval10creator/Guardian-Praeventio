// Praeventio Guard — softBlocking router contract tests.

import { describe, it, expect } from 'vitest';
import softBlockingRouter from './softBlocking';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (softBlockingRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('softBlockingRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(softBlockingRouter).toBeDefined();
    expect(typeof softBlockingRouter).toBe('function');
  });

  const paths = [
    '/:projectId/soft-blocking/evaluate-gate',
    '/:projectId/soft-blocking/validate-override',
    '/:projectId/soft-blocking/build-audit-entry',
    '/:projectId/soft-blocking/is-override-valid',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
