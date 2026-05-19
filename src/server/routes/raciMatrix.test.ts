// Praeventio Guard — raciMatrix router contract tests.

import { describe, it, expect } from 'vitest';
import raciMatrixRouter from './raciMatrix';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (raciMatrixRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('raciMatrixRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(raciMatrixRouter).toBeDefined();
    expect(typeof raciMatrixRouter).toBe('function');
  });

  const paths = [
    '/:projectId/raci-matrix/build',
    '/:projectId/raci-matrix/validate',
    '/:projectId/raci-matrix/detect-overload',
    '/:projectId/raci-matrix/find-critical-gaps',
    '/:projectId/raci-matrix/list-uids',
    '/:projectId/raci-matrix/summarize-health',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
