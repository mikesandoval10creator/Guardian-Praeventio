// Praeventio Guard — consistency router contract tests.

import { describe, it, expect } from 'vitest';
import consistencyRouter from './consistency';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (consistencyRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('consistencyRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(consistencyRouter).toBeDefined();
    expect(typeof consistencyRouter).toBe('function');
  });

  it('registers POST /:projectId/consistency/run-audit', () => {
    expect(hasPost('/:projectId/consistency/run-audit')).toBe(true);
  });

  it('registers POST /:projectId/consistency/summarize-audit', () => {
    expect(hasPost('/:projectId/consistency/summarize-audit')).toBe(true);
  });
});
