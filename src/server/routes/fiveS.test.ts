// Praeventio Guard — fiveS router contract tests.

import { describe, it, expect } from 'vitest';
import fiveSRouter from './fiveS';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (fiveSRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('fiveSRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(fiveSRouter).toBeDefined();
    expect(typeof fiveSRouter).toBe('function');
  });

  it('registers POST /:projectId/five-s/checklist', () => {
    expect(hasPost('/:projectId/five-s/checklist')).toBe(true);
  });

  it('registers POST /:projectId/five-s/build-report', () => {
    expect(hasPost('/:projectId/five-s/build-report')).toBe(true);
  });

  it('registers POST /:projectId/five-s/rank-zones', () => {
    expect(hasPost('/:projectId/five-s/rank-zones')).toBe(true);
  });
});
