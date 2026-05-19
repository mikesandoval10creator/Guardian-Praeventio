// Praeventio Guard — evacuation router contract tests.

import { describe, it, expect } from 'vitest';
import evacuationRouter from './evacuation';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (evacuationRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('evacuationRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(evacuationRouter).toBeDefined();
    expect(typeof evacuationRouter).toBe('function');
  });

  const paths = [
    '/:projectId/evacuation/compute-status',
    '/:projectId/evacuation/record-scan',
    '/:projectId/evacuation/end-drill',
    '/:projectId/evacuation/build-postmortem',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
