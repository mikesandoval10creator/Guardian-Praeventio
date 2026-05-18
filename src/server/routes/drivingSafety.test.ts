// Praeventio Guard — §69-71 router contract tests.

import { describe, it, expect } from 'vitest';
import drivingSafetyRouter from './drivingSafety';

describe('drivingSafetyRouter (§69-71 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(drivingSafetyRouter).toBeDefined();
    expect(typeof drivingSafetyRouter).toBe('function');
  });

  it('registers all 5 expected paths', () => {
    const layers = (drivingSafetyRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/driving/routes']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/driving/routes']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/driving/routes/:id/alert']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/driving/drivers']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/driving/drivers/:uid/journey']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/driving/ranking']?.has('get')).toBe(true);
  });
});
