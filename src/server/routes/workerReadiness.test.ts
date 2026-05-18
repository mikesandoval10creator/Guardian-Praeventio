// Praeventio Guard — F.16 router contract tests.

import { describe, it, expect } from 'vitest';
import workerReadinessRouter from './workerReadiness';

describe('workerReadinessRouter (F.16 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(workerReadinessRouter).toBeDefined();
    expect(typeof workerReadinessRouter).toBe('function');
  });

  it('registers GET /:projectId/worker-readiness/:workerUid', () => {
    const layers = (workerReadinessRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) => l.route?.path === '/:projectId/worker-readiness/:workerUid',
    );
    expect(layer).toBeDefined();
    expect(layer?.route?.methods.get).toBe(true);
  });
});
