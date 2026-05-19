// Praeventio Guard — roleViews router contract tests.

import { describe, it, expect } from 'vitest';
import roleViewsRouter from './roleViews';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (roleViewsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('roleViewsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(roleViewsRouter).toBeDefined();
    expect(typeof roleViewsRouter).toBe('function');
  });

  it('registers POST /:projectId/role-views/build', () => {
    expect(hasPost('/:projectId/role-views/build')).toBe(true);
  });
});
