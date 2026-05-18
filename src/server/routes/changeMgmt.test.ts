// Praeventio Guard — changeMgmt router contract tests.

import { describe, it, expect } from 'vitest';
import changeMgmtRouter from './changeMgmt';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (changeMgmtRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('changeMgmtRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(changeMgmtRouter).toBeDefined();
    expect(typeof changeMgmtRouter).toBe('function');
  });

  const paths = [
    '/:projectId/change-mgmt/declare',
    '/:projectId/change-mgmt/acknowledge',
    '/:projectId/change-mgmt/revert',
    '/:projectId/change-mgmt/summarize-acks',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
