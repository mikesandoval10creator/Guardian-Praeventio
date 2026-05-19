// Praeventio Guard — ergonomics router contract tests.

import { describe, it, expect } from 'vitest';
import ergonomicsRouter from './ergonomics';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (ergonomicsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('ergonomicsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(ergonomicsRouter).toBeDefined();
    expect(typeof ergonomicsRouter).toBe('function');
  });

  it('registers POST /:projectId/ergonomics/calculate-reba', () => {
    expect(hasPost('/:projectId/ergonomics/calculate-reba')).toBe(true);
  });

  it('registers POST /:projectId/ergonomics/calculate-rula', () => {
    expect(hasPost('/:projectId/ergonomics/calculate-rula')).toBe(true);
  });
});
