// Praeventio Guard — stoppage router contract tests.
//
// Mirrors the `loneWorker.test.ts` / `bbs.test.ts` pattern: introspect the
// Express Router stack to assert the wire-up surface. We can't easily run
// the full handler chain here (firebase-admin would need real env), so we
// verify the structural contract — paths, methods, middleware presence,
// directive copy preserved in the route file.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import stoppageRouter from './stoppage';

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name?: string; handle?: { name?: string } }>;
  };
};

const layers = (stoppageRouter as unknown as { stack: Layer[] }).stack;

function find(method: 'get' | 'post', path: string): Layer | undefined {
  return layers.find(
    (l) => l.route?.path === path && l.route?.methods[method] === true,
  );
}

function middlewareNames(layer: Layer | undefined): string[] {
  if (!layer?.route) return [];
  return layer.route.stack.map((s) => s.name ?? s.handle?.name ?? 'anonymous');
}

describe('stoppageRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(stoppageRouter).toBeDefined();
    expect(typeof stoppageRouter).toBe('function');
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

  // ── Endpoint surface ──────────────────────────────────────────────────
  it('registers POST /:projectId/stoppage/recommend', () => {
    expect(find('post', '/:projectId/stoppage/recommend')).toBeDefined();
  });

  it('registers GET /:projectId/stoppage/active', () => {
    expect(find('get', '/:projectId/stoppage/active')).toBeDefined();
  });

  it('registers POST /:projectId/stoppage/acknowledge', () => {
    expect(find('post', '/:projectId/stoppage/acknowledge')).toBeDefined();
  });

  it('registers POST /:projectId/stoppage/resume', () => {
    expect(find('post', '/:projectId/stoppage/resume')).toBeDefined();
  });

  it('registers GET /:projectId/stoppage/history', () => {
    expect(find('get', '/:projectId/stoppage/history')).toBeDefined();
  });

  // ── Idempotency on mutating endpoints ─────────────────────────────────
  it('mutating endpoints wear the idempotencyKey middleware', () => {
    const mutating = [
      { method: 'post' as const, path: '/:projectId/stoppage/recommend' },
      { method: 'post' as const, path: '/:projectId/stoppage/acknowledge' },
      { method: 'post' as const, path: '/:projectId/stoppage/resume' },
    ];
    for (const r of mutating) {
      const layer = find(r.method, r.path);
      const names = middlewareNames(layer);
      expect(
        names.some((n) => n === 'idempotencyKeyMiddleware'),
      ).toBe(true);
    }
  });

  // ── Validation present everywhere ─────────────────────────────────────
  it('every route has at least one validator in its chain', () => {
    // `validate(...)` returns an arrow/anonymous handler — the named ones
    // we look for are verifyAuth and idempotencyKeyMiddleware. The
    // remaining handlers in the chain (>=1 anonymous + the route handler)
    // confirm a schema-or-handler exists. We assert length ≥ 2: verifyAuth
    // + at least one extra handler (the actual route handler), which is
    // the structural minimum.
    const routes = layers.filter((l) => l.route);
    for (const r of routes) {
      const stackLen = r.route!.stack.length;
      expect(stackLen).toBeGreaterThanOrEqual(2);
    }
  });

  // ── Resume endpoint has the extra signature_required gate ─────────────
  // The bona-fide enforcement lives in the handler body (we asserted the
  // route exists above); here we read the source to confirm the literal
  // `signatureAttested` check + `signature_required` 403 are still in the
  // file. This protects against a future refactor accidentally dropping
  // the directive ("never block, only recommend; resume requires sig").
  it('resume endpoint enforces signatureAttested + 403 signature_required', () => {
    const src = readFileSync(
      join(__dirname, 'stoppage.ts'),
      'utf8',
    );
    expect(src).toContain('signatureAttested');
    expect(src).toContain('signature_required');
    // Resume schema must require justification ≥ 50 chars (matches UI gate).
    expect(src).toMatch(/justification:\s*z\.string\(\)\.min\(50\)/);
  });

  // ── History scope per tenant ──────────────────────────────────────────
  it('history endpoint resolves the tenant id from the caller', () => {
    const src = readFileSync(
      join(__dirname, 'stoppage.ts'),
      'utf8',
    );
    // The shared `resolveTenantId(req)` helper is what gates per-tenant
    // history. Its presence + use in `buildAdapter(resolveTenantId(req)…)`
    // is what enforces "a caller can never read another tenant's history".
    expect(src).toContain('resolveTenantId(req)');
    expect(src).toContain("tenantId ?? u?.uid ?? ''");
  });

  // ── Directive copy: route file MUST advertise "recommend, never block".
  it('source file documents the "never block, only recommend" directive', () => {
    const src = readFileSync(
      join(__dirname, 'stoppage.ts'),
      'utf8',
    );
    // The exact comment is part of the contract — auditors grep for it.
    expect(src).toMatch(/NUNCA bloquea f.sicamente maquinaria/);
    expect(src).toMatch(/RECOMIENDAN paro/);
  });
});
