// Praeventio Guard — F.29 router contract tests.
//
// Asserts that the migrated `incidentTrendsRouter` is well-formed and
// exposes the expected path. Does NOT exercise the handler end-to-end
// (that lives in the legacy `sprintK.ts` integration tests; we'll port
// them as part of the larger Sprint K migration).

import { describe, it, expect } from 'vitest';
import incidentTrendsRouter from './incidentTrends';

describe('incidentTrendsRouter (F.29 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(incidentTrendsRouter).toBeDefined();
    expect(typeof incidentTrendsRouter).toBe('function');
  });

  it('registers GET /:projectId/incidents/trends', () => {
    // Express routers expose `stack` with the registered layers. Each
    // layer with `route` is a leaf handler we can inspect.
    const layers = (incidentTrendsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const trendsLayer = layers.find(
      (l) => l.route?.path === '/:projectId/incidents/trends',
    );
    expect(trendsLayer).toBeDefined();
    expect(trendsLayer?.route?.methods.get).toBe(true);
  });
});
