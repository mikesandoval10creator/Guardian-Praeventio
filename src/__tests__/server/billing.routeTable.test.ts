// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3) regression
// pin.
//
// The billing route monolith was split into per-gateway modules under
// `src/server/routes/billing/`, with `billing.ts` left as an aggregator.
// Because this is the PAYMENT path, the split must be movement-only: every
// public endpoint (method + path + router) must survive byte-identical.
//
// This test pins the full route table of the two REAL routers, in
// registration order. If a refactor drops, renames, or reorders an endpoint
// (e.g. `/billing/webpay/return`, which is registered with Transbank's
// commerce config and CANNOT change), this fails before it ships.
//
// No HTTP mocks needed — we only introspect `router.stack` (Express 4),
// never dispatch a request.

import { describe, it, expect } from 'vitest';
import type { Router } from 'express';

import { billingApiRouter, billingWebpayRouter } from '../../server/routes/billing.js';

/** Extract `METHOD path` rows from an Express 4 router, in registration order. */
function routeTable(router: Router): string[] {
  const rows: string[] = [];
  for (const layer of (router as unknown as {
    stack: Array<{
      route?: { path: string; methods: Record<string, boolean> };
    }>;
  }).stack) {
    if (!layer.route) continue; // non-route middleware layers (none expected here)
    for (const method of Object.keys(layer.route.methods).sort()) {
      rows.push(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return rows;
}

describe('billing route table (no-regression pin, split D3)', () => {
  it('billingApiRouter (mounted at /api/billing) exposes the exact pre-split table, in order', () => {
    expect(routeTable(billingApiRouter)).toEqual([
      'POST /verify',
      'POST /webhook',
      'POST /checkout',
      'POST /invoice/:id/mark-paid',
      'GET /invoice/:id',
      'POST /checkout/mercadopago',
      'POST /webhook/mercadopago',
      'POST /khipu/webhook',
      // 2026-06-11 (khipu cableado): checkout endpoint added DELIBERATELY —
      // the third automated rail (Webpay, MercadoPago, Khipu) gets its own
      // payment-creation endpoint. Appended after the webhook so the
      // pre-existing rows stay byte-identical.
      'POST /khipu/checkout',
      'POST /google-play/validate-receipt',
      'POST /app-store/validate-receipt',
      'POST /webhook/apple',
    ]);
  });

  it('billingWebpayRouter (mounted at /billing) exposes ONLY the Transbank return URL', () => {
    // /billing/webpay/return is registered in Transbank's commerce config —
    // adding/removing/renaming anything here needs a Webpay reissue.
    expect(routeTable(billingWebpayRouter)).toEqual(['GET /webpay/return']);
  });

  it('every route carries at least one handler beyond the path match', () => {
    // Guards against an aggregator wiring a module whose register function
    // became a no-op (route present but handler list empty).
    for (const router of [billingApiRouter, billingWebpayRouter]) {
      for (const layer of (router as unknown as {
        stack: Array<{ route?: { stack: unknown[] } }>;
      }).stack) {
        if (!layer.route) continue;
        expect(layer.route.stack.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
