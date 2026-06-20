// Praeventio Guard — F.9 Data Quality router contract tests.

import { describe, it, expect } from 'vitest';
import dataQualityRouter from './dataQuality';

describe('dataQualityRouter (F.9 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(dataQualityRouter).toBeDefined();
    expect(typeof dataQualityRouter).toBe('function');
  });

  it('registers GET /:projectId/data-quality', () => {
    const layers = (dataQualityRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/data-quality' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/document-hygiene', () => {
    const layers = (dataQualityRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/document-hygiene' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
