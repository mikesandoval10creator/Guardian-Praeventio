// Praeventio Guard — safetyTalks router contract tests.

import { describe, it, expect } from 'vitest';
import safetyTalksRouter from './safetyTalks';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (safetyTalksRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('safetyTalksRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(safetyTalksRouter).toBeDefined();
    expect(typeof safetyTalksRouter).toBe('function');
  });

  it('registers POST /:projectId/safety-talks/suggest', () => {
    expect(hasPost('/:projectId/safety-talks/suggest')).toBe(true);
  });
});
