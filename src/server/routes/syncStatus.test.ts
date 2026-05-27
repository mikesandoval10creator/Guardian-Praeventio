// Praeventio Guard — syncStatus router contract tests.

import { describe, it, expect } from 'vitest';
import syncStatusRouter from './syncStatus';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (syncStatusRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('syncStatusRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(syncStatusRouter).toBeDefined();
    expect(typeof syncStatusRouter).toBe('function');
  });

  it.each([
    '/:projectId/sync-status/create-item',
    '/:projectId/sync-status/transition',
    '/:projectId/sync-status/summarize',
    '/:projectId/sync-status/find-ready',
    '/:projectId/sync-status/derive-badge',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
