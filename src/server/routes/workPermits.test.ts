// Praeventio Guard — F.15 router contract tests.

import { describe, it, expect } from 'vitest';
import workPermitsRouter from './workPermits';

describe('workPermitsRouter (F.15 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(workPermitsRouter).toBeDefined();
    expect(typeof workPermitsRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (workPermitsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/work-permits']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/work-permits']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/work-permits/:permitId/sign']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/work-permits/:permitId/close']?.has('post')).toBe(true);
  });
});
