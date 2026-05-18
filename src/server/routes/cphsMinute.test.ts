// Praeventio Guard — F.7 router contract tests.

import { describe, it, expect } from 'vitest';
import cphsMinuteRouter from './cphsMinute';

describe('cphsMinuteRouter (F.7 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(cphsMinuteRouter).toBeDefined();
    expect(typeof cphsMinuteRouter).toBe('function');
  });

  it('registers GET /:projectId/cphs/draft-minute', () => {
    const layers = (cphsMinuteRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) => l.route?.path === '/:projectId/cphs/draft-minute',
    );
    expect(layer).toBeDefined();
    expect(layer?.route?.methods.get).toBe(true);
  });
});
