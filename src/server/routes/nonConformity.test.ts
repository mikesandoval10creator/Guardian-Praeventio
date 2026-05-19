// Praeventio Guard — nonConformity router contract tests.

import { describe, it, expect } from 'vitest';
import nonConformityRouter from './nonConformity';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (nonConformityRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('nonConformityRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(nonConformityRouter).toBeDefined();
    expect(typeof nonConformityRouter).toBe('function');
  });

  const paths = [
    '/:projectId/non-conformity/link-to-action',
    '/:projectId/non-conformity/evaluate-cycle-stage',
    '/:projectId/non-conformity/bulk-classify-by-pattern',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
