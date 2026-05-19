// Praeventio Guard — climateAwareScheduling router contract tests.

import { describe, it, expect } from 'vitest';
import climateRouter from './climateAwareScheduling';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (climateRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('climateAwareSchedulingRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(climateRouter).toBeDefined();
    expect(typeof climateRouter).toBe('function');
  });

  it('registers POST /:projectId/climate-scheduling/assess-task', () => {
    expect(hasPost('/:projectId/climate-scheduling/assess-task')).toBe(true);
  });

  it('registers POST /:projectId/climate-scheduling/build-daily-plan', () => {
    expect(hasPost('/:projectId/climate-scheduling/build-daily-plan')).toBe(true);
  });
});
