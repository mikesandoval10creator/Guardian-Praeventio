// Praeventio Guard — reputationalAlerts router contract tests.

import { describe, it, expect } from 'vitest';
import reputationalAlertsRouter from './reputationalAlerts';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (reputationalAlertsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('reputationalAlertsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(reputationalAlertsRouter).toBeDefined();
    expect(typeof reputationalAlertsRouter).toBe('function');
  });

  it('registers POST /:projectId/reputational-alerts/analyze', () => {
    expect(hasPost('/:projectId/reputational-alerts/analyze')).toBe(true);
  });

  it('registers POST /:projectId/reputational-alerts/summarize', () => {
    expect(hasPost('/:projectId/reputational-alerts/summarize')).toBe(true);
  });
});
