// Praeventio Guard — jsa router contract tests.

import { describe, it, expect } from 'vitest';
import jsaRouter from './jsa';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (jsaRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('jsaRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(jsaRouter).toBeDefined();
    expect(typeof jsaRouter).toBe('function');
  });

  it('registers POST /:projectId/jsa/validate', () => {
    expect(hasPost('/:projectId/jsa/validate')).toBe(true);
  });

  it('registers POST /:projectId/jsa/compute-residual-risks', () => {
    expect(hasPost('/:projectId/jsa/compute-residual-risks')).toBe(true);
  });

  it('registers POST /:projectId/jsa/finalize', () => {
    expect(hasPost('/:projectId/jsa/finalize')).toBe(true);
  });
});
