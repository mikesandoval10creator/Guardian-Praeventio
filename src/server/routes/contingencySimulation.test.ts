// Praeventio Guard — contingencySimulation router contract tests.

import { describe, it, expect } from 'vitest';
import contingencySimulationRouter from './contingencySimulation';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (contingencySimulationRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('contingencySimulationRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(contingencySimulationRouter).toBeDefined();
    expect(typeof contingencySimulationRouter).toBe('function');
  });

  it('registers POST /:projectId/contingency/build-scenario', () => {
    expect(hasPost('/:projectId/contingency/build-scenario')).toBe(true);
  });

  it('registers POST /:projectId/contingency/list-available-scenarios', () => {
    expect(
      hasPost('/:projectId/contingency/list-available-scenarios'),
    ).toBe(true);
  });

  it('registers POST /:projectId/contingency/count-available-templates', () => {
    expect(
      hasPost('/:projectId/contingency/count-available-templates'),
    ).toBe(true);
  });

  it('registers POST /:projectId/contingency/evaluate-tabletop', () => {
    expect(hasPost('/:projectId/contingency/evaluate-tabletop')).toBe(true);
  });
});
