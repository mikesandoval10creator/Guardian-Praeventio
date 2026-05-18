// Praeventio Guard — F.28 Explainability router contract tests.

import { describe, it, expect } from 'vitest';
import explainabilityRouter from './explainability';

describe('explainabilityRouter (F.28 wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(explainabilityRouter).toBeDefined();
    expect(typeof explainabilityRouter).toBe('function');
  });

  it('registers POST /:projectId/explainability/recommendation', () => {
    const layers = (explainabilityRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/explainability/recommendation' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/explainability/batch', () => {
    const layers = (explainabilityRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/explainability/batch' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });
});
