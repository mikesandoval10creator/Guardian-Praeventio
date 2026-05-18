// Praeventio Guard — upsell router contract tests.

import { describe, it, expect } from 'vitest';
import upsellRouter from './upsell';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (upsellRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('upsellRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(upsellRouter).toBeDefined();
    expect(typeof upsellRouter).toBe('function');
  });

  it('registers POST /:projectId/upsell/suggest', () => {
    expect(hasPost('/:projectId/upsell/suggest')).toBe(true);
  });
});
