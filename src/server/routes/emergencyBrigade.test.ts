// Praeventio Guard — §74-78 router contract tests.

import { describe, it, expect } from 'vitest';
import emergencyBrigadeRouter from './emergencyBrigade';

describe('emergencyBrigadeRouter (§74-78 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(emergencyBrigadeRouter).toBeDefined();
    expect(typeof emergencyBrigadeRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (emergencyBrigadeRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/emergency-brigade']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/emergency-brigade/members']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/emergency-brigade/resources']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/emergency-brigade/resources/:id/inspect']?.has('post')).toBe(true);
  });
});
