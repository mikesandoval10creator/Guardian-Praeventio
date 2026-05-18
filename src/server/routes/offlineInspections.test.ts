// Praeventio Guard — F.6 router contract tests.

import { describe, it, expect } from 'vitest';
import offlineInspectionsRouter from './offlineInspections';

describe('offlineInspectionsRouter (F.6 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(offlineInspectionsRouter).toBeDefined();
    expect(typeof offlineInspectionsRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (offlineInspectionsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/inspections']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/inspections']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/inspections/:inspectionId/observations']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/inspections/:inspectionId/complete']?.has('post')).toBe(true);
  });
});
