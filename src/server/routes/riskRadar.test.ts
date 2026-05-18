// Praeventio Guard — F.13 router contract tests.

import { describe, it, expect } from 'vitest';
import riskRadarRouter from './riskRadar';

describe('riskRadarRouter (F.13 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(riskRadarRouter).toBeDefined();
    expect(typeof riskRadarRouter).toBe('function');
  });

  it('registers GET /:projectId/repeating-risks', () => {
    const layers = (riskRadarRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) => l.route?.path === '/:projectId/repeating-risks',
    );
    expect(layer).toBeDefined();
    expect(layer?.route?.methods.get).toBe(true);
  });
});
