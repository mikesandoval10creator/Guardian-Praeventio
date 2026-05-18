// Praeventio Guard — deduplication router contract tests.

import { describe, it, expect } from 'vitest';
import deduplicationRouter from './deduplication';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (deduplicationRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('deduplicationRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(deduplicationRouter).toBeDefined();
    expect(typeof deduplicationRouter).toBe('function');
  });

  it('registers POST /:projectId/deduplication/detect', () => {
    expect(hasPost('/:projectId/deduplication/detect')).toBe(true);
  });

  it('registers POST /:projectId/deduplication/build-merge-plan', () => {
    expect(hasPost('/:projectId/deduplication/build-merge-plan')).toBe(true);
  });
});
