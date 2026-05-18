// Praeventio Guard — efficacyVerification router contract tests.

import { describe, it, expect } from 'vitest';
import efficacyVerificationRouter from './efficacyVerification';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (efficacyVerificationRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('efficacyVerificationRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(efficacyVerificationRouter).toBeDefined();
    expect(typeof efficacyVerificationRouter).toBe('function');
  });

  it('registers POST /:projectId/efficacy/verify', () => {
    expect(hasPost('/:projectId/efficacy/verify')).toBe(true);
  });

  it('registers POST /:projectId/efficacy/default-window', () => {
    expect(hasPost('/:projectId/efficacy/default-window')).toBe(true);
  });
});
