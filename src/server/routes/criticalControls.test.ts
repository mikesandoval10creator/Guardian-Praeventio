// Praeventio Guard — criticalControls router contract tests.

import { describe, it, expect } from 'vitest';
import criticalControlsRouter from './criticalControls';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (criticalControlsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('criticalControlsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(criticalControlsRouter).toBeDefined();
    expect(typeof criticalControlsRouter).toBe('function');
  });

  const paths = [
    '/:projectId/critical-controls/get-for-risk',
    '/:projectId/critical-controls/validate-pre-task',
    '/:projectId/critical-controls/robustness-score',
    '/:projectId/critical-controls/superior-to',
    '/:projectId/critical-controls/build-barrier-analysis',
    '/:projectId/critical-controls/detect-single-barrier',
    '/:projectId/critical-controls/verification-status',
    '/:projectId/critical-controls/energy-for-control',
    '/:projectId/critical-controls/by-energy',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
