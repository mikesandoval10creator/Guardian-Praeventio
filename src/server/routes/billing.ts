// Praeventio Guard — billing route aggregator.
//
// Round 17 R2 Phase 2 extracted these endpoints from server.ts as a single
// ~2.1k-LOC monolith. Billing split step 1 (2026-05-29) moved the pricing
// constants to `./billing/pricing.ts`; step 2 (2026-06-11, deuda D3) moved
// every handler VERBATIM into per-gateway modules under `./billing/`:
//
//   • ./billing/shared.ts       — sentryCapture observability helper
//   • ./billing/pricing.ts      — tier pricing constants + validation (step 1)
//   • ./billing/googleplay.ts   — /verify + /webhook (RTDN) + Play API client
//   • ./billing/webpay.ts       — /checkout + /billing/webpay/return
//   • ./billing/invoices.ts     — /invoice/:id/mark-paid + GET /invoice/:id
//   • ./billing/mercadopago.ts  — /checkout/mercadopago + /webhook/mercadopago
//   • ./billing/khipu.ts        — /khipu/webhook (IPN)
//   • ./billing/iapReceipts.ts  — /google-play|app-store/validate-receipt
//   • ./billing/appstore.ts     — /webhook/apple (SSN v2)
//
// This file now only builds the two routers and registers the modules in the
// SAME order the monolith registered its routes — zero behavior change (this
// is the payment path; the split is movement-only). The public paths are
// pinned by src/__tests__/server/billing.routeTable.test.ts.
//
// Mount strategy (in server.ts — unchanged):
//   • app.use('/api/billing', billingApiRouter)   ← /api/billing/* routes
//   • app.use('/billing',     billingWebpayRouter) ← Webpay return only
//
// Why TWO routers? `/billing/webpay/return` is the URL Transbank redirects
// the cardholder's browser to after card entry. That URL is registered with
// Transbank's commerce config and CANNOT change to `/api/billing/...` without
// a Webpay reissue. Keeping it on its own root-mounted router preserves the
// byte-identical path while still letting the API surface live under
// `/api/billing/`.
//
// Final paths (preserved verbatim — DO NOT change):
//   • POST /api/billing/verify                  (Google Play purchase verify)
//   • POST /api/billing/webhook                 (RTDN, shared-secret + idempotency)
//   • POST /api/billing/checkout                (Webpay/manual invoice)
//   • POST /api/billing/invoice/:id/mark-paid   (admin manual fallback)
//   • GET  /api/billing/invoice/:id             (status poll, Round 13)
//   • POST /api/billing/checkout/mercadopago    (LATAM, Round 15 R2)
//   • POST /api/billing/webhook/mercadopago     (MP IPN, Round 18/19)
//   • POST /api/billing/khipu/webhook           (Khipu IPN)
//   • POST /api/billing/google-play/validate-receipt (IAP, Sprint 21 T)
//   • POST /api/billing/app-store/validate-receipt   (IAP, Sprint 21 T)
//   • POST /api/billing/webhook/apple           (Apple SSN v2, Sprint 27 H2)
//   • GET  /billing/webpay/return               (Webpay browser return)
//
// Behavior contract (covered by I3 supertest harness — see
// src/__tests__/server/billing.test.ts; that harness builds a parallel
// minimal Express app, so this extraction does not affect those tests).
// The REAL routers are exercised by src/__tests__/server/billing.router.test.ts.

import { Router } from 'express';

import { registerGooglePlayRoutes } from './billing/googleplay.js';
import { registerWebpayRoutes } from './billing/webpay.js';
import { registerInvoiceRoutes } from './billing/invoices.js';
import { registerMercadoPagoRoutes } from './billing/mercadopago.js';
import { registerKhipuRoutes } from './billing/khipu.js';
import { registerIapReceiptRoutes } from './billing/iapReceipts.js';
import { registerAppleSsnRoutes } from './billing/appstore.js';

// ────────────────────────────────────────────────────────────────────────────
// Routers — see header for the two-router rationale.
// ────────────────────────────────────────────────────────────────────────────
export const billingApiRouter = Router();
export const billingWebpayRouter = Router();

// Registration order mirrors the pre-split monolith exactly:
//   /verify, /webhook, /checkout, /invoice/:id/mark-paid, GET /invoice/:id,
//   /checkout/mercadopago, /webhook/mercadopago, (webpay return),
//   /khipu/webhook, /google-play/validate-receipt,
//   /app-store/validate-receipt, /webhook/apple.
// All paths are disjoint exact matches, but we preserve the order anyway to
// keep router.stack byte-comparable with the previous file.
registerGooglePlayRoutes(billingApiRouter);
registerWebpayRoutes(billingApiRouter, billingWebpayRouter);
registerInvoiceRoutes(billingApiRouter);
registerMercadoPagoRoutes(billingApiRouter);
registerKhipuRoutes(billingApiRouter);
registerIapReceiptRoutes(billingApiRouter);
registerAppleSsnRoutes(billingApiRouter);
