// Praeventio Guard — pymeOnboarding router contract tests.

import { describe, it, expect } from 'vitest';
import pymeOnboardingRouter from './pymeOnboarding';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (pymeOnboardingRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('pymeOnboardingRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(pymeOnboardingRouter).toBeDefined();
    expect(typeof pymeOnboardingRouter).toBe('function');
  });

  it.each([
    '/:projectId/pyme-onboarding/maturity',
    '/:projectId/pyme-onboarding/plan',
  ])('registers POST %s', (path) => {
    expect(hasPost(path)).toBe(true);
  });
});
