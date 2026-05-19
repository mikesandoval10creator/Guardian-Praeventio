// Praeventio Guard — routing router contract tests.

import { describe, it, expect } from 'vitest';
import routingRouter from './routing';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (routingRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('routingRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(routingRouter).toBeDefined();
    expect(typeof routingRouter).toBe('function');
  });

  it('registers POST /:projectId/routing/find-path-astar', () => {
    expect(hasPost('/:projectId/routing/find-path-astar')).toBe(true);
  });

  it('registers POST /:projectId/routing/assess-climate', () => {
    expect(hasPost('/:projectId/routing/assess-climate')).toBe(true);
  });
});
