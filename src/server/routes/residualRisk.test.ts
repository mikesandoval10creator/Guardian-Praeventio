// Praeventio Guard — §296-301 router contract tests.

import { describe, it, expect } from 'vitest';
import residualRiskRouter from './residualRisk';

describe('residualRiskRouter (§296-301 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(residualRiskRouter).toBeDefined();
    expect(typeof residualRiskRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (residualRiskRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/residual-risk/suspicious']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/residual-risk']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/residual-risk']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/residual-risk/:id/accept']?.has('post')).toBe(true);
  });
});
