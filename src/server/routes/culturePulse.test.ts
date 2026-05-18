// Praeventio Guard — §61-63 router contract tests.

import { describe, it, expect } from 'vitest';
import culturePulseRouter from './culturePulse';

describe('culturePulseRouter (§61-63 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(culturePulseRouter).toBeDefined();
    expect(typeof culturePulseRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (culturePulseRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/culture-pulse']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/culture-pulse/survey']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/culture-pulse/survey/:id/respond']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/culture-pulse/history']?.has('get')).toBe(true);
  });
});
