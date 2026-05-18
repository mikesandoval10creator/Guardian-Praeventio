// Praeventio Guard — F.3 SIF Precursors router contract tests.

import { describe, it, expect } from 'vitest';
import sifRouter from './sif';

describe('sifRouter (F.3 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(sifRouter).toBeDefined();
    expect(typeof sifRouter).toBe('function');
  });

  it('registers GET /:projectId/sif/pending-review', () => {
    const layers = (sifRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/sif/pending-review' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/sif/:id/executive-review', () => {
    const layers = (sifRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/sif/:id/executive-review' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });
});
