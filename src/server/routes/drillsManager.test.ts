// Praeventio Guard — F.20 router contract tests.

import { describe, it, expect } from 'vitest';
import drillsManagerRouter from './drillsManager';

describe('drillsManagerRouter (F.20 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(drillsManagerRouter).toBeDefined();
    expect(typeof drillsManagerRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (drillsManagerRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/drills']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/drills/:drillId']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/drills/plan']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/drills/:drillId/execute']?.has('post')).toBe(true);
  });
});
