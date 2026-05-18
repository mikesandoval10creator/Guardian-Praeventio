// Praeventio Guard — multiProject router contract tests.

import { describe, it, expect } from 'vitest';
import multiProjectRouter from './multiProject';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (multiProjectRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('multiProjectRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(multiProjectRouter).toBeDefined();
    expect(typeof multiProjectRouter).toBe('function');
  });

  it('registers POST /:projectId/multi-project/compare', () => {
    expect(hasPost('/:projectId/multi-project/compare')).toBe(true);
  });

  it('registers POST /:projectId/multi-project/best-practices', () => {
    expect(hasPost('/:projectId/multi-project/best-practices')).toBe(true);
  });

  it('registers POST /:projectId/multi-project/risk-projects', () => {
    expect(hasPost('/:projectId/multi-project/risk-projects')).toBe(true);
  });
});
