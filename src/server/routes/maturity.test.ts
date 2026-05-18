// Praeventio Guard — F.26 router contract tests.

import { describe, it, expect } from 'vitest';
import maturityRouter from './maturity';

describe('maturityRouter (F.26 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(maturityRouter).toBeDefined();
    expect(typeof maturityRouter).toBe('function');
  });

  it('registers GET /:projectId/maturity-index', () => {
    const layers = (maturityRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) => l.route?.path === '/:projectId/maturity-index',
    );
    expect(layer).toBeDefined();
    expect(layer?.route?.methods.get).toBe(true);
  });
});
