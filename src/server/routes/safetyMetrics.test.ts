// Praeventio Guard — safetyMetrics router contract tests.

import { describe, it, expect } from 'vitest';
import safetyMetricsRouter from './safetyMetrics';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (safetyMetricsRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('safetyMetricsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(safetyMetricsRouter).toBeDefined();
    expect(typeof safetyMetricsRouter).toBe('function');
  });

  it('registers POST /:projectId/safety-metrics/build-report', () => {
    expect(hasPost('/:projectId/safety-metrics/build-report')).toBe(true);
  });

  it('registers POST /:projectId/safety-metrics/compare-vs-industry', () => {
    expect(hasPost('/:projectId/safety-metrics/compare-vs-industry')).toBe(true);
  });

  it('registers POST /:projectId/safety-metrics/analyze-trend', () => {
    expect(hasPost('/:projectId/safety-metrics/analyze-trend')).toBe(true);
  });
});
