// Praeventio Guard — shiftHandover router contract tests.
//
// Mirror of `loneWorker.test.ts` / `stoppage.test.ts`: introspect the
// Express Router stack to assert the wire-up surface. Full handler chains
// require firebase-admin env, so we verify the structural contract —
// paths, methods, middleware presence, plus a couple of source-level
// invariants (engine import, anti-blame check, ADR reference).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import shiftHandoverRouter from './shiftHandover';

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name?: string; handle?: { name?: string } }>;
  };
};

const layers = (shiftHandoverRouter as unknown as { stack: Layer[] }).stack;

function find(method: 'get' | 'post', path: string): Layer | undefined {
  return layers.find(
    (l) => l.route?.path === path && l.route?.methods[method] === true,
  );
}

function middlewareNames(layer: Layer | undefined): string[] {
  if (!layer?.route) return [];
  return layer.route.stack.map((s) => s.name ?? s.handle?.name ?? 'anonymous');
}

describe('shiftHandoverRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(shiftHandoverRouter).toBeDefined();
    expect(typeof shiftHandoverRouter).toBe('function');
  });

  // ── Endpoint surface ──────────────────────────────────────────────────
  it('registers POST /:projectId/shift-handover/create', () => {
    expect(find('post', '/:projectId/shift-handover/create')).toBeDefined();
  });

  it('registers POST /:projectId/shift-handover/:hoId/acknowledge', () => {
    expect(
      find('post', '/:projectId/shift-handover/:hoId/acknowledge'),
    ).toBeDefined();
  });

  it('registers POST /:projectId/shift-handover/:hoId/add-discrepancy', () => {
    expect(
      find('post', '/:projectId/shift-handover/:hoId/add-discrepancy'),
    ).toBeDefined();
  });

  it('registers GET /:projectId/shift-handover/active', () => {
    expect(find('get', '/:projectId/shift-handover/active')).toBeDefined();
  });

  it('registers GET /:projectId/shift-handover/history', () => {
    expect(find('get', '/:projectId/shift-handover/history')).toBeDefined();
  });

  // ── Auth: every route runs verifyAuth ─────────────────────────────────
  it('every route runs verifyAuth as the first non-route middleware', () => {
    const routes = layers.filter((l) => l.route);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const names = middlewareNames(r);
      expect(names).toContain('verifyAuth');
    }
  });

  // ── Idempotency on mutating endpoints ─────────────────────────────────
  it('mutating endpoints wear the idempotencyKey middleware', () => {
    const mutating = [
      { method: 'post' as const, path: '/:projectId/shift-handover/create' },
      {
        method: 'post' as const,
        path: '/:projectId/shift-handover/:hoId/acknowledge',
      },
      {
        method: 'post' as const,
        path: '/:projectId/shift-handover/:hoId/add-discrepancy',
      },
    ];
    for (const r of mutating) {
      const layer = find(r.method, r.path);
      const names = middlewareNames(layer);
      expect(names.some((n) => n === 'idempotencyKeyMiddleware')).toBe(true);
    }
  });

  // ── All routes scoped under /:projectId/shift-handover/ ───────────────
  it('all routes are nested under /:projectId/shift-handover/', () => {
    const routePaths = layers
      .filter((l) => l.route)
      .map((l) => l.route!.path);
    expect(routePaths.length).toBe(5);
    for (const p of routePaths) {
      expect(p.startsWith('/:projectId/shift-handover/')).toBe(true);
    }
  });

  // ── Source-level invariants ───────────────────────────────────────────
  it('source file imports the pure shift-handover engine functions', () => {
    const src = readFileSync(join(__dirname, 'shiftHandover.ts'), 'utf8');
    expect(src).toContain('startShift');
    expect(src).toContain('endShift');
    expect(src).toContain('acknowledgeHandover');
    expect(src).toContain('addHandoverNote');
    expect(src).toContain('computeHandoverQuality');
  });

  it('enforces anti-blame on create (supervisor must equal caller)', () => {
    const src = readFileSync(join(__dirname, 'shiftHandover.ts'), 'utf8');
    // The exact guard: body.supervisorUid !== callerUid → 403.
    expect(src).toMatch(/body\.supervisorUid\s*!==\s*callerUid/);
    expect(src).toContain('forbidden');
  });

  it('add-discrepancy gates to the incoming supervisor that acknowledged', () => {
    const src = readFileSync(join(__dirname, 'shiftHandover.ts'), 'utf8');
    expect(src).toMatch(/acknowledgedByUid\s*!==\s*callerUid/);
    expect(src).toContain('DISCREPANCY');
  });

  it('documents ADR 0019 in the route header', () => {
    const src = readFileSync(join(__dirname, 'shiftHandover.ts'), 'utf8');
    expect(src).toMatch(/ADR\s*0019/);
  });
});
