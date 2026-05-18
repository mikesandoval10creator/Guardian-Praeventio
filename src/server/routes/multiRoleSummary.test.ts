// Praeventio Guard — Multi-Role Summary router contract tests.

import { describe, it, expect } from 'vitest';
import multiRoleSummaryRouter from './multiRoleSummary';

describe('multiRoleSummaryRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(multiRoleSummaryRouter).toBeDefined();
    expect(typeof multiRoleSummaryRouter).toBe('function');
  });

  it('registers POST /:projectId/role-summary/compose', () => {
    const layers = (multiRoleSummaryRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/role-summary/compose' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/role-summary/compose-all', () => {
    const layers = (multiRoleSummaryRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/role-summary/compose-all' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/role-summary/filter-lessons', () => {
    const layers = (multiRoleSummaryRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/role-summary/filter-lessons' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });
});
