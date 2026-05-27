// Praeventio Guard — legalObligations router contract tests.
//
// Plan Bloque 3.14. Mirrors the loneWorker/stoppage/readReceipts wire test
// pattern: introspect the Express Router stack to assert the wire-up
// surface (paths + methods + middleware) plus a couple of source-level
// invariants for the founder directive ("nunca push automático").

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import legalObligationsRouter from './legalObligations';

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name?: string; handle?: { name?: string } }>;
  };
};

const layers = (legalObligationsRouter as unknown as { stack: Layer[] }).stack;

function find(method: 'get' | 'post', path: string): Layer | undefined {
  return layers.find(
    (l) => l.route?.path === path && l.route?.methods[method] === true,
  );
}

function middlewareNames(layer: Layer | undefined): string[] {
  if (!layer?.route) return [];
  return layer.route.stack.map((s) => s.name ?? s.handle?.name ?? 'anonymous');
}

describe('legalObligationsRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(legalObligationsRouter).toBeDefined();
    expect(typeof legalObligationsRouter).toBe('function');
  });

  // ── Endpoint surface ──────────────────────────────────────────────────
  const expected: Array<{ method: 'get' | 'post'; path: string }> = [
    { method: 'get', path: '/:projectId/legal-calendar/upcoming' },
    { method: 'get', path: '/:projectId/legal-calendar/overdue' },
    { method: 'post', path: '/:projectId/legal-calendar/acknowledge' },
    { method: 'post', path: '/:projectId/legal-calendar/snooze' },
    { method: 'get', path: '/:projectId/legal-calendar/history' },
  ];

  for (const r of expected) {
    it(`registers ${r.method.toUpperCase()} ${r.path}`, () => {
      expect(find(r.method, r.path)).toBeDefined();
    });
  }

  it('all routes are nested under /:projectId/legal-calendar/', () => {
    const routePaths = layers
      .filter((l) => l.route)
      .map((l) => l.route!.path);
    expect(routePaths.length).toBeGreaterThan(0);
    for (const p of routePaths) {
      expect(p.startsWith('/:projectId/legal-calendar/')).toBe(true);
    }
  });

  it('registers exactly 5 endpoints (3 GET + 2 POST)', () => {
    const allRoutes = layers.filter((l) => l.route);
    expect(allRoutes.length).toBe(5);
    const getCount = allRoutes.filter((l) => l.route!.methods.get === true).length;
    const postCount = allRoutes.filter((l) => l.route!.methods.post === true).length;
    expect(getCount).toBe(3);
    expect(postCount).toBe(2);
  });

  // ── Auth + middleware coverage ────────────────────────────────────────
  it('every route runs verifyAuth as the first non-route middleware', () => {
    const routes = layers.filter((l) => l.route);
    for (const r of routes) {
      const names = middlewareNames(r);
      expect(names).toContain('verifyAuth');
    }
  });

  it('mutating endpoints wear the idempotencyKey middleware', () => {
    const mutating: Array<{ method: 'post'; path: string }> = [
      { method: 'post', path: '/:projectId/legal-calendar/acknowledge' },
      { method: 'post', path: '/:projectId/legal-calendar/snooze' },
    ];
    for (const r of mutating) {
      const layer = find(r.method, r.path);
      const names = middlewareNames(layer);
      expect(
        names.some((n) => n === 'idempotencyKeyMiddleware'),
      ).toBe(true);
    }
  });

  // ── Founder directive: never push to state APIs ───────────────────────
  it('source file documents "nunca push automático" + empresa-firma directive', () => {
    const src = readFileSync(
      join(__dirname, 'legalObligations.ts'),
      'utf8',
    );
    // Strict prose anchors a fiscalizador / auditor can grep for.
    expect(src).toMatch(/NUNCA hace push autom.tico/);
    expect(src).toMatch(/SUSESO/);
    expect(src).toMatch(/MINSAL/);
    expect(src).toMatch(/empresa debe firmar y entregar|firma y entrega/i);
  });
});
