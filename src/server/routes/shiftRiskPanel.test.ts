// Praeventio Guard — shiftRiskPanel router contract tests.

import { describe, it, expect } from 'vitest';
import shiftRiskPanelRouter from './shiftRiskPanel';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (shiftRiskPanelRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('shiftRiskPanelRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(shiftRiskPanelRouter).toBeDefined();
    expect(typeof shiftRiskPanelRouter).toBe('function');
  });

  it('registers POST /:projectId/shift-risk-panel/compose', () => {
    expect(hasPost('/:projectId/shift-risk-panel/compose')).toBe(true);
  });
});
