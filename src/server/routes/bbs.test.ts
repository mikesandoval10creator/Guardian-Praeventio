// Praeventio Guard — bbs router contract tests.

import { describe, it, expect } from 'vitest';
import bbsRouter from './bbs';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (bbsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('bbsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(bbsRouter).toBeDefined();
    expect(typeof bbsRouter).toBe('function');
  });

  it('registers POST /:projectId/bbs/record-observation', () => {
    expect(hasPost('/:projectId/bbs/record-observation')).toBe(true);
  });

  it('registers POST /:projectId/bbs/build-profile', () => {
    expect(hasPost('/:projectId/bbs/build-profile')).toBe(true);
  });
});
