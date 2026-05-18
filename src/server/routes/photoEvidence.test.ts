// Praeventio Guard — F.19 Photo Evidence router contract tests.

import { describe, it, expect } from 'vitest';
import photoEvidenceRouter from './photoEvidence';

describe('photoEvidenceRouter (F.19 wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(photoEvidenceRouter).toBeDefined();
    expect(typeof photoEvidenceRouter).toBe('function');
  });

  it('registers POST /:projectId/photo-evidence', () => {
    const layers = (photoEvidenceRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/photo-evidence' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/photo-evidence/by-node/:kind/:id', () => {
    const layers = (photoEvidenceRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/photo-evidence/by-node/:kind/:id' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/photo-evidence/:artifactId/linkage', () => {
    const layers = (photoEvidenceRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/photo-evidence/:artifactId/linkage' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });
});
