// Praeventio Guard — skillGap router contract tests.

import { describe, it, expect } from 'vitest';
import skillGapRouter from './skillGap';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (skillGapRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('skillGapRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(skillGapRouter).toBeDefined();
    expect(typeof skillGapRouter).toBe('function');
  });

  it('registers POST /:projectId/skills/analyze-gaps', () => {
    expect(hasPost('/:projectId/skills/analyze-gaps')).toBe(true);
  });

  it('registers POST /:projectId/skills/build-training-plan', () => {
    expect(hasPost('/:projectId/skills/build-training-plan')).toBe(true);
  });

  it('registers POST /:projectId/skills/polyvalence-matrix', () => {
    expect(hasPost('/:projectId/skills/polyvalence-matrix')).toBe(true);
  });

  it('registers POST /:projectId/skills/find-substitutes', () => {
    expect(hasPost('/:projectId/skills/find-substitutes')).toBe(true);
  });
});
