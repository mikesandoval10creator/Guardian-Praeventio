// Praeventio Guard — adminBurden router contract tests.

import { describe, it, expect } from 'vitest';
import adminBurdenRouter from './adminBurden';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (adminBurdenRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('adminBurdenRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(adminBurdenRouter).toBeDefined();
    expect(typeof adminBurdenRouter).toBe('function');
  });

  it('registers POST /:projectId/admin-burden/report', () => {
    expect(hasPost('/:projectId/admin-burden/report')).toBe(true);
  });

  it('registers POST /:projectId/admin-burden/suggest-automations', () => {
    expect(hasPost('/:projectId/admin-burden/suggest-automations')).toBe(true);
  });
});
