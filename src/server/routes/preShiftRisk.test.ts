// Praeventio Guard — F.21 router contract tests.

import { describe, it, expect } from 'vitest';
import preShiftRiskRouter from './preShiftRisk';

describe('preShiftRiskRouter (F.21 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(preShiftRiskRouter).toBeDefined();
    expect(typeof preShiftRiskRouter).toBe('function');
  });

  it('registers GET /:projectId/pre-shift-risk', () => {
    const layers = (preShiftRiskRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) => l.route?.path === '/:projectId/pre-shift-risk',
    );
    expect(layer).toBeDefined();
    expect(layer?.route?.methods.get).toBe(true);
  });
});
