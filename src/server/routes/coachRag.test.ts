// Praeventio Guard — coachRag router contract tests.

import { describe, it, expect } from 'vitest';
import coachRagRouter from './coachRag';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (coachRagRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('coachRagRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(coachRagRouter).toBeDefined();
    expect(typeof coachRagRouter).toBe('function');
  });

  it('registers POST /:projectId/coach-rag/search-top-k', () => {
    expect(hasPost('/:projectId/coach-rag/search-top-k')).toBe(true);
  });

  it('registers POST /:projectId/coach-rag/list-chunks', () => {
    expect(hasPost('/:projectId/coach-rag/list-chunks')).toBe(true);
  });

  it('registers POST /:projectId/coach-rag/get-domain-prompt', () => {
    expect(hasPost('/:projectId/coach-rag/get-domain-prompt')).toBe(true);
  });
});
