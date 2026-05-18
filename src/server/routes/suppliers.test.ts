// Praeventio Guard — §90-91 router contract tests.

import { describe, it, expect } from 'vitest';
import suppliersRouter from './suppliers';

describe('suppliersRouter (§90-91 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(suppliersRouter).toBeDefined();
    expect(typeof suppliersRouter).toBe('function');
  });

  it('registers all 5 expected paths', () => {
    const layers = (suppliersRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/suppliers']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/suppliers']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/suppliers/:id/incidents']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/suppliers/:id/audits']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/suppliers/ranking']?.has('get')).toBe(true);
  });
});
