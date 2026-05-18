// Praeventio Guard — continuity router contract tests.

import { describe, it, expect } from 'vitest';
import continuityRouter from './continuity';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (continuityRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('continuityRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(continuityRouter).toBeDefined();
    expect(typeof continuityRouter).toBe('function');
  });

  it('registers POST /:projectId/continuity/detect-spofs', () => {
    expect(hasPost('/:projectId/continuity/detect-spofs')).toBe(true);
  });

  it('registers POST /:projectId/continuity/simulate-outage', () => {
    expect(hasPost('/:projectId/continuity/simulate-outage')).toBe(true);
  });

  it('registers POST /:projectId/continuity/build-polyvalence-plan', () => {
    expect(hasPost('/:projectId/continuity/build-polyvalence-plan')).toBe(true);
  });
});
