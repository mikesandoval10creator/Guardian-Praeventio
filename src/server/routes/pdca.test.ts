// Praeventio Guard — §195-200 router contract tests.

import { describe, it, expect } from 'vitest';
import pdcaRouter from './pdca';

describe('pdcaRouter (§195-200 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(pdcaRouter).toBeDefined();
    expect(typeof pdcaRouter).toBe('function');
  });

  it('registers all 6 expected paths', () => {
    const layers = (pdcaRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/pdca/cycles']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/pdca/cycles']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/pdca/cycles/:id/advance']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/pdca/non-conformities']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/pdca/non-conformities']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/pdca/summary']?.has('get')).toBe(true);
  });
});
