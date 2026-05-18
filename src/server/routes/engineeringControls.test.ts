// Praeventio Guard — §42-44 router contract tests.

import { describe, it, expect } from 'vitest';
import engineeringControlsRouter from './engineeringControls';

describe('engineeringControlsRouter (§42-44 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(engineeringControlsRouter).toBeDefined();
    expect(typeof engineeringControlsRouter).toBe('function');
  });

  it('registers all 3 expected paths', () => {
    const layers = (engineeringControlsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/engineering-controls']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/engineering-controls']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/engineering-controls/:id/verify']?.has('post')).toBe(true);
  });
});
