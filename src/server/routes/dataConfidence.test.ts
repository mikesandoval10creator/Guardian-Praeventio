import { describe, it, expect } from 'vitest';
import dataConfidenceRouter from './dataConfidence';

describe('dataConfidenceRouter (§104 migration contract)', () => {
  it('exports a Router instance', () => {
    expect(dataConfidenceRouter).toBeDefined();
    expect(typeof dataConfidenceRouter).toBe('function');
  });

  it('registers GET /:projectId/data-confidence', () => {
    const layers = (dataConfidenceRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find((l) => l.route?.path === '/:projectId/data-confidence');
    expect(layer).toBeDefined();
    expect(layer?.route?.methods.get).toBe(true);
  });

  it('registers POST /:projectId/data-confidence/dismiss/:issueId', () => {
    const layers = (dataConfidenceRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) => l.route?.path === '/:projectId/data-confidence/dismiss/:issueId',
    );
    expect(layer).toBeDefined();
    expect(layer?.route?.methods.post).toBe(true);
  });

  it('registers GET /:projectId/data-confidence/recommendations', () => {
    const layers = (dataConfidenceRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) => l.route?.path === '/:projectId/data-confidence/recommendations',
    );
    expect(layer).toBeDefined();
    expect(layer?.route?.methods.get).toBe(true);
  });
});
