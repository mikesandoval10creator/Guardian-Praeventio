// Praeventio Guard — predictiveAlerts router contract tests.

import { describe, it, expect } from 'vitest';
import predictiveAlertsRouter from './predictiveAlerts';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (predictiveAlertsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('predictiveAlertsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(predictiveAlertsRouter).toBeDefined();
    expect(typeof predictiveAlertsRouter).toBe('function');
  });

  it.each([
    '/:projectId/predictive-alerts/should-fire-windowed',
    '/:projectId/predictive-alerts/evaluate-probes',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
