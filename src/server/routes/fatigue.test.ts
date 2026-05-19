// Praeventio Guard — fatigue router contract tests.

import { describe, it, expect } from 'vitest';
import fatigueRouter from './fatigue';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (fatigueRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('fatigueRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(fatigueRouter).toBeDefined();
    expect(typeof fatigueRouter).toBe('function');
  });

  it('registers POST /:projectId/fatigue/assess', () => {
    expect(hasPost('/:projectId/fatigue/assess')).toBe(true);
  });
});
