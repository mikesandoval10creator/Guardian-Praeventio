// Praeventio Guard — Equipment Master router contract tests.

import { describe, it, expect } from 'vitest';
import equipmentRouter from './equipment';

describe('equipmentRouter (I.5 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(equipmentRouter).toBeDefined();
    expect(typeof equipmentRouter).toBe('function');
  });

  it('registers GET /:projectId/equipment', () => {
    const layers = (equipmentRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/equipment' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
