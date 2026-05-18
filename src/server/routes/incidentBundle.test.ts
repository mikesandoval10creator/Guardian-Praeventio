// Praeventio Guard — F.3 Incident Evidence Bundle router contract tests.

import { describe, it, expect } from 'vitest';
import incidentBundleRouter from './incidentBundle';

describe('incidentBundleRouter (F.3 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(incidentBundleRouter).toBeDefined();
    expect(typeof incidentBundleRouter).toBe('function');
  });

  it('registers GET /:projectId/incidents/:incidentId/bundle', () => {
    const layers = (incidentBundleRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/incidents/:incidentId/bundle' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
