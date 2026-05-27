// Praeventio Guard — projectComparator router contract tests.

import { describe, it, expect } from 'vitest';
import projectComparatorRouter from './projectComparator';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (projectComparatorRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('projectComparatorRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(projectComparatorRouter).toBeDefined();
    expect(typeof projectComparatorRouter).toBe('function');
  });

  it('registers POST /:projectId/project-comparator/compare', () => {
    expect(hasPost('/:projectId/project-comparator/compare')).toBe(true);
  });
});
