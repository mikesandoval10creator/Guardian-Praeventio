// Praeventio Guard — mentalLoad router contract tests.

import { describe, it, expect } from 'vitest';
import mentalLoadRouter from './mentalLoad';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (mentalLoadRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('mentalLoadRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(mentalLoadRouter).toBeDefined();
    expect(typeof mentalLoadRouter).toBe('function');
  });

  it('registers POST /:projectId/mental-load/score-survey', () => {
    expect(hasPost('/:projectId/mental-load/score-survey')).toBe(true);
  });

  it('registers POST /:projectId/mental-load/build-admin-burden', () => {
    expect(hasPost('/:projectId/mental-load/build-admin-burden')).toBe(true);
  });
});
