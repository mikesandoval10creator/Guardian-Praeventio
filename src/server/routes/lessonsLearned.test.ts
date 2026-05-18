// Praeventio Guard — F.12 router contract tests.

import { describe, it, expect } from 'vitest';
import lessonsLearnedRouter from './lessonsLearned';

describe('lessonsLearnedRouter (F.12 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(lessonsLearnedRouter).toBeDefined();
    expect(typeof lessonsLearnedRouter).toBe('function');
  });

  it('registers GET and POST /:projectId/lessons', () => {
    const layers = (lessonsLearnedRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const lessonsLayer = layers.find(
      (l) => l.route?.path === '/:projectId/lessons',
    );
    expect(lessonsLayer).toBeDefined();
    expect(lessonsLayer?.route?.methods.get || lessonsLayer?.route?.methods.post).toBe(true);
    const all = layers.filter((l) => l.route?.path === '/:projectId/lessons');
    const methods = new Set<string>();
    for (const l of all) {
      for (const m of Object.keys(l.route?.methods ?? {})) methods.add(m);
    }
    expect(methods.has('get')).toBe(true);
    expect(methods.has('post')).toBe(true);
  });
});
