// Praeventio Guard — privacyRetention router contract tests.

import { describe, it, expect } from 'vitest';
import privacyRetentionRouter from './privacyRetention';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (privacyRetentionRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('privacyRetentionRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(privacyRetentionRouter).toBeDefined();
    expect(typeof privacyRetentionRouter).toBe('function');
  });

  it('registers POST /:projectId/privacy/decide-retention', () => {
    expect(hasPost('/:projectId/privacy/decide-retention')).toBe(true);
  });

  it('registers POST /:projectId/privacy/check-consent', () => {
    expect(hasPost('/:projectId/privacy/check-consent')).toBe(true);
  });

  it('registers POST /:projectId/privacy/pii-bucket', () => {
    expect(hasPost('/:projectId/privacy/pii-bucket')).toBe(true);
  });

  it('registers POST /:projectId/privacy/sensitivity-for-category', () => {
    expect(hasPost('/:projectId/privacy/sensitivity-for-category')).toBe(true);
  });
});
