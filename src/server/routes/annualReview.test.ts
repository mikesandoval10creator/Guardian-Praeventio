// Praeventio Guard — §291-295 router contract tests.

import { describe, it, expect } from 'vitest';
import annualReviewRouter from './annualReview';

describe('annualReviewRouter (§291-295 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(annualReviewRouter).toBeDefined();
    expect(typeof annualReviewRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (annualReviewRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/annual-review/current']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/annual-review/objectives']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/annual-review/evidence']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/annual-review/conclude']?.has('post')).toBe(true);
  });
});
