// Praeventio Guard — orgMetrics router contract tests.

import { describe, it, expect } from 'vitest';
import orgMetricsRouter from './orgMetrics';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (orgMetricsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('orgMetricsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(orgMetricsRouter).toBeDefined();
    expect(typeof orgMetricsRouter).toBe('function');
  });

  it('registers POST /:projectId/org-metrics/detect-silos', () => {
    expect(hasPost('/:projectId/org-metrics/detect-silos')).toBe(true);
  });

  it('registers POST /:projectId/org-metrics/build-friction-report', () => {
    expect(hasPost('/:projectId/org-metrics/build-friction-report')).toBe(true);
  });

  it('registers POST /:projectId/org-metrics/build-closure-time-report', () => {
    expect(hasPost('/:projectId/org-metrics/build-closure-time-report')).toBe(true);
  });

  it('registers POST /:projectId/org-metrics/detect-chronic-gaps', () => {
    expect(hasPost('/:projectId/org-metrics/detect-chronic-gaps')).toBe(true);
  });

  it('registers POST /:projectId/org-metrics/compute-operational-pressure', () => {
    expect(hasPost('/:projectId/org-metrics/compute-operational-pressure')).toBe(true);
  });
});
