// Praeventio Guard — preventionCost router contract tests (Bloque 3.15).
//
// Mirror of loneWorker.test.ts. Validates the router shape:
//   - is a usable Router instance
//   - registers exactly the 3 endpoints declared in the route file
//   - all under the /:projectId/cost/ namespace
//   - method shapes (POST simulate/save, GET scenarios)
//
// The engine math itself is exercised by
//   src/services/costCalculator/preventionCostCalculator.test.ts
// so this file only proves the HTTP wiring.

import { describe, it, expect } from 'vitest';
import preventionCostRouter from './preventionCost';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (preventionCostRouter as unknown as { stack: Layer[] }).stack;

function findRoute(path: string): Layer['route'] | undefined {
  return layers.find((l) => l.route?.path === path)?.route;
}

function hasMethod(path: string, method: 'post' | 'get'): boolean {
  return findRoute(path)?.methods?.[method] === true;
}

describe('preventionCostRouter (wire-up contract)', () => {
  it('exports a Router instance (function-shaped)', () => {
    expect(preventionCostRouter).toBeDefined();
    expect(typeof preventionCostRouter).toBe('function');
  });

  it('registers POST /:projectId/cost/simulate', () => {
    expect(hasMethod('/:projectId/cost/simulate', 'post')).toBe(true);
  });

  it('registers POST /:projectId/cost/save-scenario', () => {
    expect(hasMethod('/:projectId/cost/save-scenario', 'post')).toBe(true);
  });

  it('registers GET /:projectId/cost/scenarios', () => {
    expect(hasMethod('/:projectId/cost/scenarios', 'get')).toBe(true);
  });

  it('registers exactly 3 endpoints', () => {
    const routeLayers = layers.filter((l) => l.route);
    expect(routeLayers.length).toBe(3);
  });

  it('all routes are nested under /:projectId/cost/', () => {
    const routePaths = layers.filter((l) => l.route).map((l) => l.route!.path);
    for (const p of routePaths) {
      expect(p.startsWith('/:projectId/cost/')).toBe(true);
    }
  });

  it('save-scenario is POST-only (no GET on the mutation path)', () => {
    expect(hasMethod('/:projectId/cost/save-scenario', 'get')).toBe(false);
    expect(hasMethod('/:projectId/cost/save-scenario', 'post')).toBe(true);
  });

  it('scenarios listing is GET-only (no POST on the read path)', () => {
    expect(hasMethod('/:projectId/cost/scenarios', 'post')).toBe(false);
    expect(hasMethod('/:projectId/cost/scenarios', 'get')).toBe(true);
  });
});
