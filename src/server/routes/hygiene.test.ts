// Praeventio Guard — hygiene router contract tests.

import { describe, it, expect } from 'vitest';
import hygieneRouter from './hygiene';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (hygieneRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('hygieneRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(hygieneRouter).toBeDefined();
    expect(typeof hygieneRouter).toBe('function');
  });

  it('registers POST /:projectId/hygiene/bmr', () => {
    expect(hasPost('/:projectId/hygiene/bmr')).toBe(true);
  });

  it('registers POST /:projectId/hygiene/current-burn', () => {
    expect(hasPost('/:projectId/hygiene/current-burn')).toBe(true);
  });
});
