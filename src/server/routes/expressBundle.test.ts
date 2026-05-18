// Praeventio Guard — expressBundle router contract tests.

import { describe, it, expect } from 'vitest';
import expressBundleRouter from './expressBundle';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (expressBundleRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('expressBundleRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(expressBundleRouter).toBeDefined();
    expect(typeof expressBundleRouter).toBe('function');
  });

  it('registers POST /:projectId/express-bundle/build', () => {
    expect(hasPost('/:projectId/express-bundle/build')).toBe(true);
  });
});
