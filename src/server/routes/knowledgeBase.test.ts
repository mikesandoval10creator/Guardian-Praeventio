// Praeventio Guard — §185-190 router contract tests.

import { describe, it, expect } from 'vitest';
import knowledgeBaseRouter from './knowledgeBase';

describe('knowledgeBaseRouter (§185-190 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(knowledgeBaseRouter).toBeDefined();
    expect(typeof knowledgeBaseRouter).toBe('function');
  });

  it('registers all 4 expected paths', () => {
    const layers = (knowledgeBaseRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const methodsByPath: Record<string, Set<string>> = {};
    for (const l of layers) {
      if (!l.route) continue;
      methodsByPath[l.route.path] ??= new Set();
      for (const m of Object.keys(l.route.methods)) methodsByPath[l.route.path].add(m);
    }
    expect(methodsByPath['/:projectId/knowledge-base']?.has('get')).toBe(true);
    expect(methodsByPath['/:projectId/knowledge-base']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/knowledge-base/:id/use']?.has('post')).toBe(true);
    expect(methodsByPath['/:projectId/knowledge-base/:id/flag-obsolete']?.has('post')).toBe(true);
  });
});
