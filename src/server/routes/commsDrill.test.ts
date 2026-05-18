// Praeventio Guard — commsDrill router contract tests.

import { describe, it, expect } from 'vitest';
import commsDrillRouter from './commsDrill';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (commsDrillRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('commsDrillRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(commsDrillRouter).toBeDefined();
    expect(typeof commsDrillRouter).toBe('function');
  });

  it('registers POST /:projectId/comms-drills/list-scripts', () => {
    expect(hasPost('/:projectId/comms-drills/list-scripts')).toBe(true);
  });

  it('registers POST /:projectId/comms-drills/get-by-id', () => {
    expect(hasPost('/:projectId/comms-drills/get-by-id')).toBe(true);
  });

  it('registers POST /:projectId/comms-drills/score', () => {
    expect(hasPost('/:projectId/comms-drills/score')).toBe(true);
  });

  it('registers POST /:projectId/comms-drills/plan-schedule', () => {
    expect(hasPost('/:projectId/comms-drills/plan-schedule')).toBe(true);
  });
});
