// Praeventio Guard — return-to-work router contract tests.

import { describe, it, expect } from 'vitest';
import returnToWorkRouter from './returnToWork';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (returnToWorkRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('returnToWorkRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(returnToWorkRouter).toBeDefined();
    expect(typeof returnToWorkRouter).toBe('function');
  });

  it('registers POST /:projectId/return-to-work/assess-task-fit', () => {
    expect(hasPost('/:projectId/return-to-work/assess-task-fit')).toBe(true);
  });

  it('registers POST /:projectId/return-to-work/decide-derivation', () => {
    expect(hasPost('/:projectId/return-to-work/decide-derivation')).toBe(true);
  });

  it('registers POST /:projectId/return-to-work/build-plan', () => {
    expect(hasPost('/:projectId/return-to-work/build-plan')).toBe(true);
  });
});
