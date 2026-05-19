// Praeventio Guard — expirations router contract tests.

import { describe, it, expect } from 'vitest';
import expirationsRouter from './expirations';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (expirationsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('expirationsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(expirationsRouter).toBeDefined();
    expect(typeof expirationsRouter).toBe('function');
  });

  it('registers POST /:projectId/expirations/scan', () => {
    expect(hasPost('/:projectId/expirations/scan')).toBe(true);
  });

  it('registers POST /:projectId/expirations/build-finding-payload', () => {
    expect(hasPost('/:projectId/expirations/build-finding-payload')).toBe(true);
  });
});
