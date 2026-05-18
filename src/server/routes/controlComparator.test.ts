// Praeventio Guard — Control Comparator router contract tests.

import { describe, it, expect } from 'vitest';
import controlComparatorRouter from './controlComparator';

describe('controlComparatorRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(controlComparatorRouter).toBeDefined();
    expect(typeof controlComparatorRouter).toBe('function');
  });

  it('registers POST /:projectId/controls/compare', () => {
    const layers = (controlComparatorRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/controls/compare' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/controls/failures/lookup', () => {
    const layers = (controlComparatorRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/controls/failures/lookup' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/controls/failures/suggest', () => {
    const layers = (controlComparatorRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/controls/failures/suggest' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/controls/failures/summary', () => {
    const layers = (controlComparatorRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/controls/failures/summary' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
