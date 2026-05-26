// Praeventio Guard — eppFlow router contract tests.

import { describe, it, expect } from 'vitest';
import eppFlowRouter from './eppFlow';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (eppFlowRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

function hasGet(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.get === true,
  );
}

describe('eppFlowRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(eppFlowRouter).toBeDefined();
    expect(typeof eppFlowRouter).toBe('function');
  });

  it('registers POST /:projectId/epp-flow/inspection', () => {
    expect(hasPost('/:projectId/epp-flow/inspection')).toBe(true);
  });

  it('registers GET /:projectId/epp-flow/pending-orders', () => {
    expect(hasGet('/:projectId/epp-flow/pending-orders')).toBe(true);
  });

  it('registers POST /:projectId/epp-flow/sign-order/:orderId', () => {
    expect(hasPost('/:projectId/epp-flow/sign-order/:orderId')).toBe(true);
  });

  it('registers GET /:projectId/epp-flow/order-pdf/:orderId', () => {
    expect(hasGet('/:projectId/epp-flow/order-pdf/:orderId')).toBe(true);
  });

  it('exposes a layer count >= 4 (one per endpoint)', () => {
    const routeLayers = layers.filter((l) => l.route);
    expect(routeLayers.length).toBeGreaterThanOrEqual(4);
  });

  it('only registers the four documented endpoints (no accidental extras)', () => {
    const paths = new Set(
      layers.filter((l) => l.route).map((l) => l.route!.path),
    );
    expect(paths.has('/:projectId/epp-flow/inspection')).toBe(true);
    expect(paths.has('/:projectId/epp-flow/pending-orders')).toBe(true);
    expect(paths.has('/:projectId/epp-flow/sign-order/:orderId')).toBe(true);
    expect(paths.has('/:projectId/epp-flow/order-pdf/:orderId')).toBe(true);
    // No router-level catch-alls accidentally registered.
    expect(paths.size).toBe(4);
  });

  it('all 4 endpoints route under /:projectId/epp-flow/* (consistent prefix)', () => {
    const routePaths = layers
      .filter((l) => l.route)
      .map((l) => l.route!.path);
    for (const p of routePaths) {
      expect(p.startsWith('/:projectId/epp-flow/')).toBe(true);
    }
  });
});
