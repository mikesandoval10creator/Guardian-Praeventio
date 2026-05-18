// Praeventio Guard — §214-215 router contract tests.

import { describe, it, expect } from 'vitest';
import positiveObservationsRouter from './positiveObservations';

describe('positiveObservationsRouter (§214-215 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(positiveObservationsRouter).toBeDefined();
    expect(typeof positiveObservationsRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (positiveObservationsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const paths = new Set<string>();
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      paths.add(l.route.path);
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(paths.has('/:projectId/positive-observations')).toBe(true);
    expect(paths.has('/:projectId/positive-observations/balance')).toBe(true);
    expect(paths.has('/:projectId/positive-observations/worker/:workerUid')).toBe(true);
    expect(methodsByPath['/:projectId/positive-observations'].has('get')).toBe(true);
    expect(methodsByPath['/:projectId/positive-observations'].has('post')).toBe(true);
    expect(methodsByPath['/:projectId/positive-observations/balance'].has('get')).toBe(true);
    expect(methodsByPath['/:projectId/positive-observations/worker/:workerUid'].has('get')).toBe(true);
  });
});
