// Praeventio Guard — F.4 Corrective Actions Center router contract tests.

import { describe, it, expect } from 'vitest';
import correctiveActionsRouter from './correctiveActions';

describe('correctiveActionsRouter (F.4 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(correctiveActionsRouter).toBeDefined();
    expect(typeof correctiveActionsRouter).toBe('function');
  });

  it('registers GET /:projectId/corrective-actions', () => {
    const layers = (correctiveActionsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/corrective-actions' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/corrective-actions', () => {
    const layers = (correctiveActionsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/corrective-actions' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/corrective-actions/:actionId/effectiveness-review', () => {
    const layers = (correctiveActionsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path ===
          '/:projectId/corrective-actions/:actionId/effectiveness-review' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });
});
