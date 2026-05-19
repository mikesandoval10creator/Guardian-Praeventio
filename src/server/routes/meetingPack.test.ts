// Praeventio Guard — meetingPack router contract tests.

import { describe, it, expect } from 'vitest';
import meetingPackRouter from './meetingPack';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (meetingPackRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('meetingPackRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(meetingPackRouter).toBeDefined();
    expect(typeof meetingPackRouter).toBe('function');
  });

  const paths = [
    '/:projectId/meeting-pack/build-summary',
    '/:projectId/meeting-pack/build-supervisor-briefing',
    '/:projectId/meeting-pack/extract-action-items',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
