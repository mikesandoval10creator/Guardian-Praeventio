// Praeventio Guard — escalation router contract tests.

import { describe, it, expect } from 'vitest';
import escalationRouter from './escalation';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (escalationRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('escalationRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(escalationRouter).toBeDefined();
    expect(typeof escalationRouter).toBe('function');
  });

  const paths = [
    '/:projectId/escalation/sla-minutes',
    '/:projectId/escalation/assess-sla',
    '/:projectId/escalation/decide',
    '/:projectId/escalation/apply',
    '/:projectId/escalation/process-batch',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
