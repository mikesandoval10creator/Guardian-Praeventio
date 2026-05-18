// Praeventio Guard — §131-138 router contract tests.

import { describe, it, expect } from 'vitest';
import projectClosureRouter from './projectClosure';

describe('projectClosureRouter (§131-138 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(projectClosureRouter).toBeDefined();
    expect(typeof projectClosureRouter).toBe('function');
  });

  it('registers all 6 expected paths', () => {
    const layers = (projectClosureRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/closure/status']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/closure/initiate']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/closure/lessons']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/closure/decisions']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/closure/finalize']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/closure/summary']?.has('get')).toBe(true);
  });
});
