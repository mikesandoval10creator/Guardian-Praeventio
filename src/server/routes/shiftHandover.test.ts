// Praeventio Guard — shiftHandover router contract tests.

import { describe, it, expect } from 'vitest';
import shiftHandoverRouter from './shiftHandover';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (shiftHandoverRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('shiftHandoverRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(shiftHandoverRouter).toBeDefined();
    expect(typeof shiftHandoverRouter).toBe('function');
  });

  it.each([
    '/:projectId/shift-handover/start',
    '/:projectId/shift-handover/log-entry',
    '/:projectId/shift-handover/add-note',
    '/:projectId/shift-handover/end',
    '/:projectId/shift-handover/acknowledge',
    '/:projectId/shift-handover/summarize',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
