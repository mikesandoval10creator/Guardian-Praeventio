// Praeventio Guard — signaletics router contract tests.

import { describe, it, expect } from 'vitest';
import signaleticsRouter from './signaletics';

describe('signaleticsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(signaleticsRouter).toBeDefined();
    expect(typeof signaleticsRouter).toBe('function');
  });

  it('registers POST /:projectId/signaletics/audit-zone', () => {
    const layers = (signaleticsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/signaletics/audit-zone' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/signaletics/rank-site', () => {
    const layers = (signaleticsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/signaletics/rank-site' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/signaletics/evacuation-paths', () => {
    const layers = (signaleticsRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/signaletics/evacuation-paths' &&
        l.route?.methods.post === true,
    );
    expect(layer).toBeDefined();
  });
});
