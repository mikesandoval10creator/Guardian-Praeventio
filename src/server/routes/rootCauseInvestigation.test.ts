// Praeventio Guard — rootCauseInvestigation router contract tests.

import { describe, it, expect } from 'vitest';
import rootCauseInvestigationRouter from './rootCauseInvestigation';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (rootCauseInvestigationRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('rootCauseInvestigationRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(rootCauseInvestigationRouter).toBeDefined();
    expect(typeof rootCauseInvestigationRouter).toBe('function');
  });

  it('registers POST /:projectId/investigations/build-tree', () => {
    expect(hasPost('/:projectId/investigations/build-tree')).toBe(true);
  });

  it('registers POST /:projectId/investigations/extract-chain', () => {
    expect(hasPost('/:projectId/investigations/extract-chain')).toBe(true);
  });

  it('registers POST /:projectId/investigations/classify-category', () => {
    expect(hasPost('/:projectId/investigations/classify-category')).toBe(true);
  });

  it('registers POST /:projectId/investigations/is-shallow-answer', () => {
    expect(hasPost('/:projectId/investigations/is-shallow-answer')).toBe(true);
  });
});
