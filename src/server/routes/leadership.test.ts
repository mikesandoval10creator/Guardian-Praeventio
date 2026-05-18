// Praeventio Guard — §276-277 router contract tests.

import { describe, it, expect } from 'vitest';
import leadershipRouter from './leadership';

describe('leadershipRouter (§276-277 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(leadershipRouter).toBeDefined();
    expect(typeof leadershipRouter).toBe('function');
  });

  it('registers all 3 expected paths', () => {
    const layers = (leadershipRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/leadership/decisions']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/leadership/decisions']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/leadership/ranking']?.has('get')).toBe(true);
  });
});
