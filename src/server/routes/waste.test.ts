// Praeventio Guard — §229-236 Waste Inventory router contract tests.

import { describe, it, expect } from 'vitest';
import wasteRouter from './waste';

describe('wasteRouter (§229-236 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(wasteRouter).toBeDefined();
    expect(typeof wasteRouter).toBe('function');
  });

  it('registers GET /:projectId/waste/inventory', () => {
    const layers = (wasteRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/waste/inventory' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
