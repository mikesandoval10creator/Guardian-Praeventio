// Praeventio Guard — researchMode router contract tests.

import { describe, it, expect } from 'vitest';
import researchModeRouter from './researchMode';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (researchModeRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('researchModeRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(researchModeRouter).toBeDefined();
    expect(typeof researchModeRouter).toBe('function');
  });

  it('registers POST /:projectId/research-mode/find-root-branches', () => {
    expect(hasPost('/:projectId/research-mode/find-root-branches')).toBe(true);
  });

  it('registers POST /:projectId/research-mode/summarize-tree', () => {
    expect(hasPost('/:projectId/research-mode/summarize-tree')).toBe(true);
  });

  it('registers POST /:projectId/research-mode/compare-trees', () => {
    expect(hasPost('/:projectId/research-mode/compare-trees')).toBe(true);
  });

  it('registers POST /:projectId/research-mode/detect-failed-control-patterns', () => {
    expect(hasPost('/:projectId/research-mode/detect-failed-control-patterns')).toBe(true);
  });
});
