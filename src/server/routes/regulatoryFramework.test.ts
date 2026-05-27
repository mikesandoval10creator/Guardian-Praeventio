// Praeventio Guard — regulatoryFramework router contract tests.

import { describe, it, expect } from 'vitest';
import regulatoryFrameworkRouter from './regulatoryFramework';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (regulatoryFrameworkRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('regulatoryFrameworkRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(regulatoryFrameworkRouter).toBeDefined();
    expect(typeof regulatoryFrameworkRouter).toBe('function');
  });

  it.each([
    '/:projectId/regulatory/active-jurisdictions',
    '/:projectId/regulatory/cite',
    '/:projectId/regulatory/resolve-control',
    '/:projectId/regulatory/list-controls',
    '/:projectId/regulatory/references',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
