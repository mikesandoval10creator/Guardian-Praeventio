// Praeventio Guard — agenda router contract tests.

import { describe, it, expect } from 'vitest';
import agendaRouter from './agenda';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (agendaRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('agendaRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(agendaRouter).toBeDefined();
    expect(typeof agendaRouter).toBe('function');
  });

  const paths = [
    '/:projectId/agenda/schedule-reminders',
    '/:projectId/agenda/select-channel',
    '/:projectId/agenda/should-deliver',
    '/:projectId/agenda/in-focus-block',
    '/:projectId/agenda/build-daily-digest',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
