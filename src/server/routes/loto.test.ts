// Praeventio Guard — LOTO Digital router contract tests.

import { describe, it, expect } from 'vitest';
import lotoRouter from './loto';

describe('lotoRouter (LOTO migration contract)', () => {
  it('exports a Router instance', () => {
    expect(lotoRouter).toBeDefined();
    expect(typeof lotoRouter).toBe('function');
  });

  it('registers GET /:projectId/loto', () => {
    const layers = (lotoRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) => l.route?.path === '/:projectId/loto' && l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
