// Praeventio Guard — vendorOnboarding router contract tests.

import { describe, it, expect } from 'vitest';
import vendorOnboardingRouter from './vendorOnboarding';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (vendorOnboardingRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('vendorOnboardingRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(vendorOnboardingRouter).toBeDefined();
    expect(typeof vendorOnboardingRouter).toBe('function');
  });

  it('registers POST /:projectId/vendors/onboarding/evaluate-stage', () => {
    expect(hasPost('/:projectId/vendors/onboarding/evaluate-stage')).toBe(true);
  });

  it('registers POST /:projectId/vendors/:vendorId/onboarding/missing-mandatory', () => {
    expect(
      hasPost('/:projectId/vendors/:vendorId/onboarding/missing-mandatory'),
    ).toBe(true);
  });

  it('registers POST /:projectId/vendors/onboarding/build-client-bundle', () => {
    expect(hasPost('/:projectId/vendors/onboarding/build-client-bundle')).toBe(
      true,
    );
  });

  it('registers POST /:projectId/vendors/:vendorId/accreditation/summarize', () => {
    expect(
      hasPost('/:projectId/vendors/:vendorId/accreditation/summarize'),
    ).toBe(true);
  });

  it('registers POST /:projectId/vendors/:vendorId/accreditation/should-escalate', () => {
    expect(
      hasPost('/:projectId/vendors/:vendorId/accreditation/should-escalate'),
    ).toBe(true);
  });
});
