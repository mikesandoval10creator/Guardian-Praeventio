// Praeventio Guard — criticalRoles router contract tests.

import { describe, it, expect } from 'vitest';
import criticalRolesRouter from './criticalRoles';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (criticalRolesRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('criticalRolesRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(criticalRolesRouter).toBeDefined();
    expect(typeof criticalRolesRouter).toBe('function');
  });

  const paths = [
    '/:projectId/critical-roles/for-industry',
    '/:projectId/critical-roles/find-by-code',
    '/:projectId/critical-roles/build-coverage',
    '/:projectId/critical-roles/suggest-training',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
