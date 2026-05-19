// Praeventio Guard — contractors router contract tests.

import { describe, it, expect } from 'vitest';
import contractorsRouter from './contractors';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (contractorsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('contractorsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(contractorsRouter).toBeDefined();
    expect(typeof contractorsRouter).toBe('function');
  });

  const paths = [
    '/:projectId/contractors/compute-kpi',
    '/:projectId/contractors/rank-by-risk',
    '/:projectId/contractors/acreditation-gap-report',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
