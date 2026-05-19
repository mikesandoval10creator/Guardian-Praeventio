// Praeventio Guard — auditPortal router contract tests.

import { describe, it, expect } from 'vitest';
import auditPortalRouter from './auditPortal';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (auditPortalRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('auditPortalRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(auditPortalRouter).toBeDefined();
    expect(typeof auditPortalRouter).toBe('function');
  });

  const paths = [
    '/:projectId/audit-portal/create-portal',
    '/:projectId/audit-portal/derive-status',
    '/:projectId/audit-portal/revoke',
    '/:projectId/audit-portal/check-access',
    '/:projectId/audit-portal/summarize-usage',
    '/:projectId/audit-portal/generate-token',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
