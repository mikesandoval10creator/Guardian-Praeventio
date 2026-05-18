// Praeventio Guard — privacyShield router contract tests.

import { describe, it, expect } from 'vitest';
import privacyShieldRouter from './privacyShield';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (privacyShieldRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('privacyShieldRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(privacyShieldRouter).toBeDefined();
    expect(typeof privacyShieldRouter).toBe('function');
  });

  it('registers POST /:projectId/privacy-shield/classify-field', () => {
    expect(hasPost('/:projectId/privacy-shield/classify-field')).toBe(true);
  });

  it('registers POST /:projectId/privacy-shield/detect-gaps', () => {
    expect(hasPost('/:projectId/privacy-shield/detect-gaps')).toBe(true);
  });

  it('registers POST /:projectId/privacy-shield/reap-expired', () => {
    expect(hasPost('/:projectId/privacy-shield/reap-expired')).toBe(true);
  });
});
