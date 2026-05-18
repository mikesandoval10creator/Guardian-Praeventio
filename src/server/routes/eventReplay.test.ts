// Praeventio Guard — eventReplay router contract tests.

import { describe, it, expect } from 'vitest';
import eventReplayRouter from './eventReplay';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (eventReplayRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('eventReplayRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(eventReplayRouter).toBeDefined();
    expect(typeof eventReplayRouter).toBe('function');
  });

  it('registers POST /:projectId/event-replay/execute', () => {
    expect(hasPost('/:projectId/event-replay/execute')).toBe(true);
  });

  it('registers POST /:projectId/event-replay/diff-states', () => {
    expect(hasPost('/:projectId/event-replay/diff-states')).toBe(true);
  });

  it('registers POST /:projectId/event-replay/export-trail', () => {
    expect(hasPost('/:projectId/event-replay/export-trail')).toBe(true);
  });
});
