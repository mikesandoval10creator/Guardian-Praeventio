// Praeventio Guard — safetyPerformance router contract tests.

import { describe, it, expect } from 'vitest';
import safetyPerformanceRouter from './safetyPerformance';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (safetyPerformanceRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('safetyPerformanceRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(safetyPerformanceRouter).toBeDefined();
    expect(typeof safetyPerformanceRouter).toBe('function');
  });

  it('registers POST /:projectId/safety-performance/compute', () => {
    expect(hasPost('/:projectId/safety-performance/compute')).toBe(true);
  });

  it('registers POST /:projectId/safety-performance/build-trend', () => {
    expect(hasPost('/:projectId/safety-performance/build-trend')).toBe(true);
  });
});
