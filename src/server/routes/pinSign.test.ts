// Praeventio Guard — pinSign router contract tests.

import { describe, it, expect } from 'vitest';
import pinSignRouter from './pinSign';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (pinSignRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('pinSignRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(pinSignRouter).toBeDefined();
    expect(typeof pinSignRouter).toBe('function');
  });

  it.each([
    '/:projectId/pin-sign/validate-policy',
    '/:projectId/pin-sign/register',
    '/:projectId/pin-sign/verify',
    '/:projectId/pin-sign/sign-item',
    '/:projectId/pin-sign/verify-acknowledgement',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
