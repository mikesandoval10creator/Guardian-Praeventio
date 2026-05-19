// Praeventio Guard — driving router contract tests.

import { describe, it, expect } from 'vitest';
import drivingRouter from './driving';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (drivingRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('drivingRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(drivingRouter).toBeDefined();
    expect(typeof drivingRouter).toBe('function');
  });

  const paths = [
    '/:projectId/driving/haversine-meters',
    '/:projectId/driving/accumulate-trip-mileage',
    '/:projectId/driving/detect-aggressive-brake',
  ];

  for (const path of paths) {
    it(`registers POST ${path}`, () => {
      expect(hasPost(path)).toBe(true);
    });
  }
});
