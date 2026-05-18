// Praeventio Guard — routeScoring router contract tests.

import { describe, it, expect } from 'vitest';
import routeScoringRouter from './routeScoring';

describe('routeScoringRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(routeScoringRouter).toBeDefined();
    expect(typeof routeScoringRouter).toBe('function');
  });

  it('registers POST /:projectId/routes/build-profile', () => {
    const layers = (routeScoringRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/routes/build-profile' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/routes/evaluate-driver', () => {
    const layers = (routeScoringRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/routes/evaluate-driver' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });
});
