// Praeventio Guard — roiScenario router contract tests.

import { describe, it, expect } from 'vitest';
import roiScenarioRouter from './roiScenario';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (roiScenarioRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('roiScenarioRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(roiScenarioRouter).toBeDefined();
    expect(typeof roiScenarioRouter).toBe('function');
  });

  it('registers POST /:projectId/roi-scenario/compare', () => {
    expect(hasPost('/:projectId/roi-scenario/compare')).toBe(true);
  });
});
