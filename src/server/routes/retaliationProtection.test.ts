// Praeventio Guard — retaliationProtection router contract tests.

import { describe, it, expect } from 'vitest';
import retaliationProtectionRouter from './retaliationProtection';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (retaliationProtectionRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('retaliationProtectionRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(retaliationProtectionRouter).toBeDefined();
    expect(typeof retaliationProtectionRouter).toBe('function');
  });

  it('registers POST /:projectId/retaliation/analyze', () => {
    expect(hasPost('/:projectId/retaliation/analyze')).toBe(true);
  });

  it('registers POST /:projectId/retaliation/recommend-actions', () => {
    expect(hasPost('/:projectId/retaliation/recommend-actions')).toBe(true);
  });
});
