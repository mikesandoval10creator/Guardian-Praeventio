// Praeventio Guard — firstResponderMap router contract tests.

import { describe, it, expect } from 'vitest';
import firstResponderMapRouter from './firstResponderMap';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (firstResponderMapRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('firstResponderMapRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(firstResponderMapRouter).toBeDefined();
    expect(typeof firstResponderMapRouter).toBe('function');
  });

  it('registers POST /:projectId/first-responder-map/build-dispatch-plan', () => {
    expect(hasPost('/:projectId/first-responder-map/build-dispatch-plan')).toBe(true);
  });

  it('registers POST /:projectId/first-responder-map/analyze-coverage', () => {
    expect(hasPost('/:projectId/first-responder-map/analyze-coverage')).toBe(true);
  });
});
