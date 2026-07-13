// Real-router supertest for src/server/routes/billing.ts
//
// Exercises the REAL billingApiRouter + billingWebpayRouter mounted at the
// same prefixes as server.ts:
//   app.use('/api/billing', billingApiRouter)
//   app.use('/billing',     billingWebpayRouter)
//
// The existing billing.test.ts / billing.webhookReplay.test.ts run against
// the parallel-copy `buildTestServer` harness. This file mounts the REAL
// router via fakeFirestore (Plan v3 real-router pattern) so the actual
// handler code — verifyAuth shim, idempotency middleware, Zod schemas,
// adapter calls, Firestore side-effects — is exercised.
//
// Constraints:
//   • NEVER call a real payment API — all adapters are mocked.
//   • Tier-gating assertions read users/{uid}.subscription.planId
//     server-side, not trusting client input (CLAUDE.md #11).
//   • Webhook signature tests cover bad-sig → 401/400 and good-sig → 200.
//   • Idempotency: replayed Khipu webhook does NOT double-apply.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted holder — vi.hoisted so the mock factory can close over it.
// ─────────────────────────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // Swappable auth: default returns a non-admin user.
  getUser: vi.fn(async (uid: string) => ({
    uid,
    customClaims: {},
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// firebase-admin mock
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    getUser: (...args: unknown[]) => H.getUser(...(args as [string])),
    verifyIdToken: async () => ({ uid: 'test' }),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyAuth shim: reads x-test-uid + optional x-test-email headers.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: req.header('x-test-email') ?? `${uid}@test.com`,
    };
    next();
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency + limiters — pass-through in tests
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/limiters.js', () => ({
  invoiceStatusLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  googlePlayWebhookLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Logger + observability — silence in tests
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_name: string, _tags: unknown, fn: () => unknown) => fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Webpay adapter mock — vi.hoisted so the factory can close over them
// ─────────────────────────────────────────────────────────────────────────────
const M = vi.hoisted(() => ({
  webpayIsConfigured: vi.fn(() => true),
  webpayCreate: vi.fn(async () => ({ token: 'tok-wp-1', url: 'https://webpay.test/start' })),
  webpayCommit: vi.fn(
    async (
      _token: string,
    ): Promise<{
      status: 'AUTHORIZED' | 'REJECTED' | 'FAILED';
      buyOrder: string;
      amount: number;
      authorizationCode?: string;
      cardLast4?: string;
    }> => ({
      status: 'AUTHORIZED',
      buyOrder: 'inv-webpay-1',
      amount: 11990,
      authorizationCode: 'AUTH-001',
      cardLast4: '6623',
    }),
  ),
  acquireWebpayLock: vi.fn(
    async (): Promise<{
      acquired: boolean;
      alreadyDone?: boolean;
      inFlight?: boolean;
      outcome?: 'paid' | 'rejected' | 'failed';
      invoiceId?: string;
    }> => ({ acquired: true }),
  ),
  finalizeWebpayLock: vi.fn(async () => undefined),
  khipuVerify: vi.fn(() => true),
  khipuGetStatus: vi.fn(async () => ({
    status: 'completed' as 'completed' | 'pending' | 'cancelled' | 'expired',
    buyOrder: 'inv-khipu-1',
    amount: 50000,
    paymentId: 'kh-pay-1',
  })),
  khipuIsConfigured: vi.fn(() => true),
  khipuCreate: vi.fn(async (_tx: Record<string, unknown>) => ({
    paymentId: 'kh-new-1',
    paymentUrl: 'https://khipu.test/pay/kh-new-1',
    expiresAt: '2026-06-12T00:00:00.000Z',
    raw: {},
  })),
  mpOidc: vi.fn(
    async (): Promise<{ valid: boolean; reason?: string }> => ({ valid: false, reason: 'no-oidc' }),
  ),
  mpAnyFormat: vi.fn(() => true),
  mpProcess: vi.fn(async () => ({
    idempotencyKind: 'fresh-success' as const,
    outcome: 'paid' as const,
    invoiceId: 'inv-mp-1',
  })),
  mpIsConfigured: vi.fn(() => false),
  mpCreatePreference: vi.fn(async () => ({ id: 'pref-1', init_point: 'https://mp.test/pay' })),
  // B5/B15 — DTE decision + emitter, overridable per-test (mark-paid parity).
  decideDte: vi.fn(
    (_req?: unknown): Record<string, unknown> => ({
      shouldIssue: false,
      documentKind: null,
      reason: 'test',
      idempotencyKey: 'idem-test',
    }),
  ),
  tryAutoIssue: vi.fn(
    async (
      _invoice?: unknown,
    ): Promise<{ ok: boolean; skipped?: string; errorMessage?: string; result?: { ok: boolean; folio?: number } }> => ({
      ok: true,
      result: { ok: true, folio: 1001 },
    }),
  ),
}));

vi.mock('../../services/billing/webpayAdapter.js', () => ({
  webpayAdapter: {
    isConfigured: () => M.webpayIsConfigured(),
    createTransaction: M.webpayCreate,
    commitTransaction: (...args: unknown[]) => M.webpayCommit(...(args as [string])),
  },
  acquireWebpayIdempotencyLock: M.acquireWebpayLock,
  finalizeWebpayIdempotencyLock: M.finalizeWebpayLock,
}));
vi.mock('../../services/billing/webpayMetrics.js', () => ({
  recordWebpayReturnLatency: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// KhipuAdapter mock
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../services/billing/khipuAdapter.js', () => ({
  KhipuAdapter: {
    fromEnv: () => ({
      verifyWebhookSignature: M.khipuVerify,
      getPaymentStatus: M.khipuGetStatus,
      isConfigured: () => M.khipuIsConfigured(),
      createPayment: M.khipuCreate,
    }),
  },
  KhipuAdapterError: class KhipuAdapterError extends Error {},
}));

// ─────────────────────────────────────────────────────────────────────────────
// MercadoPago IPN + adapter mocks
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../services/billing/mercadoPagoIpn.js', () => ({
  verifyMercadoPagoIpnSignatureFromBody: vi.fn(() => true),
  verifyMpIpnAnyFormat: M.mpAnyFormat,
  verifyMercadoPagoIpnOidc: M.mpOidc,
  processMercadoPagoIpn: M.mpProcess,
}));
vi.mock('../../services/billing/mercadoPagoAdapter.js', () => ({
  mercadoPagoAdapter: {
    isConfigured: () => M.mpIsConfigured(),
    createPreference: M.mpCreatePreference,
  },
  MercadoPagoAdapterError: class MercadoPagoAdapterError extends Error {},
}));

// ─────────────────────────────────────────────────────────────────────────────
// Google Play / Apple IAP validators
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../services/billing/googlePlayValidator.js', () => ({
  validateGooglePlaySubscription: vi.fn(async () => ({
    ok: true,
    productId: 'praeventio.oro.monthly',
    expiryMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
    regionCode: 'CL',
    subscriptionState: 'active',
  })),
}));
vi.mock('../../services/billing/appleTransactionValidator.js', () => ({
  validateAppleTransaction: vi.fn(async () => ({
    ok: true,
    productId: 'praeventio.oro.monthly',
    expiryMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
    environment: 'Sandbox',
    originalTransactionId: 'orig-txn-1',
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Apple SSN
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../services/billing/appleSsn.js', () => ({
  verifyAndDecodeAppleSsn: vi.fn(async () => ({
    payload: {
      notificationUUID: 'apple-uuid-1',
      notificationType: 'DID_RENEW',
      subtype: null,
    },
    verifiedChain: false,
  })),
  applyAppleEntitlement: vi.fn(async () => ({ action: 'subscription_renewed', userId: 'uid-A' })),
  buildAppleSsnAuditRow: vi.fn(() => ({ verified: false })),
  AppleSsnVerificationError: class AppleSsnVerificationError extends Error {},
}));

// ─────────────────────────────────────────────────────────────────────────────
// DTE orchestrator — stub decision (overridable via M.decideDte) + emitter
// (M.tryAutoIssue). The rest of services/billing/invoice.js stays REAL —
// the checkout handlers use its pure helpers (buildInvoice / totals).
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../services/dte/dteAutoIssueOrchestrator.js', () => ({
  decideDteIssue: (...args: unknown[]) => M.decideDte(...(args as [unknown])),
}));
vi.mock('../../services/billing/invoice.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/billing/invoice.js')>();
  return {
    ...actual,
    tryAutoIssueDte: (...args: unknown[]) => M.tryAutoIssue(...(args as [unknown])),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// auditLog — pass-through (best-effort in real code)
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// safeSecretEqual — real constant-time compare kept; only needed for webhook
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../server/middleware/safeSecretEqual.js', () => ({
  safeSecretEqual: (a: string, b: string) => a === b,
}));

// ─────────────────────────────────────────────────────────────────────────────
// googleapis (Google Play Developer API used by /verify + /webhook)
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('googleapis', () => ({
  google: {
    androidpublisher: () => ({
      purchases: {
        subscriptions: { get: vi.fn(async () => ({ data: { orderId: 'GPA.0001', paymentState: 1 } })) },
        products: { get: vi.fn(async () => ({ data: { orderId: 'GPA.prod-1' } })) },
      },
    }),
    auth: { fromJSON: vi.fn(() => ({ scopes: [] })) },
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// normalizeSubscriptionPlanId
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../services/pricing/subscriptionPlan.js', async () => {
  // Keep the REAL cycle helpers (cycleFromInvoiceDoc / cycleFromProductId /
  // DEFAULT_SUBSCRIPTION_CYCLE) so activation persists the cycle faithfully;
  // only the plan normalization is stubbed permissive for these tests.
  const actual = await vi.importActual<typeof import('../../services/pricing/subscriptionPlan.js')>(
    '../../services/pricing/subscriptionPlan.js',
  );
  return {
    ...actual,
    normalizeSubscriptionPlanId: (id: string) => id ?? 'comite',
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// import REAL routers after all mocks are in place
// ─────────────────────────────────────────────────────────────────────────────
import { billingApiRouter, billingWebpayRouter } from '../../server/routes/billing.js';
import { logger } from '../../utils/logger.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  // The Khipu webhook route mounts its own express.raw() middleware. Because
  // route-level middleware runs AFTER app-level middleware, we must NOT apply
  // express.json() globally — it would consume the body before express.raw()
  // gets a chance to. Instead we apply express.json() only to non-raw paths
  // using a conditional guard.
  app.use((req, _res, next) => {
    // Skip global json for the Khipu webhook — it uses express.raw() inline.
    if (req.path === '/api/billing/khipu/webhook') return next();
    express.json()(req, _res, next);
  });
  app.use('/api/billing', billingApiRouter);
  app.use('/billing', billingWebpayRouter);
  return app;
}

// Minimal valid checkout body
const validCheckout = {
  tierId: 'plata',
  cycle: 'monthly',
  currency: 'CLP',
  paymentMethod: 'webpay',
  totalWorkers: 10,
  totalProjects: 1,
  cliente: {
    nombre: 'Empresa Test SA',
    email: 'pagos@empresa.test',
    rut: '12.345.678-9',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  H.db = createFakeFirestore();
  // Default: non-admin user
  H.getUser.mockReset();
  H.getUser.mockImplementation(async (uid: string) => ({
    uid,
    customClaims: {},
  }));
  // Reset adapter mocks (clear call history so assertions like .not.toHaveBeenCalled() work)
  M.webpayIsConfigured.mockReset().mockReturnValue(true);
  M.webpayCreate.mockReset().mockResolvedValue({ token: 'tok-wp-1', url: 'https://webpay.test/start' });
  M.webpayCommit.mockReset().mockResolvedValue({
    status: 'AUTHORIZED' as const,
    buyOrder: 'inv-webpay-1',
    amount: 11990,
    authorizationCode: 'AUTH-001',
    cardLast4: '6623',
  });
  M.acquireWebpayLock.mockReset().mockResolvedValue({ acquired: true });
  M.finalizeWebpayLock.mockReset().mockResolvedValue(undefined);
  M.khipuVerify.mockReset().mockReturnValue(true);
  M.khipuGetStatus.mockReset().mockResolvedValue({
    status: 'completed' as const,
    buyOrder: 'inv-khipu-1',
    amount: 50000,
    paymentId: 'kh-pay-1',
  });
  M.khipuIsConfigured.mockReset().mockReturnValue(true);
  M.khipuCreate.mockReset().mockResolvedValue({
    paymentId: 'kh-new-1',
    paymentUrl: 'https://khipu.test/pay/kh-new-1',
    expiresAt: '2026-06-12T00:00:00.000Z',
    raw: {},
  });
  M.mpAnyFormat.mockReturnValue(true);
  M.mpOidc.mockResolvedValue({ valid: false, reason: 'no-oidc' });
  M.mpProcess.mockResolvedValue({
    idempotencyKind: 'fresh-success' as const,
    outcome: 'paid' as const,
    invoiceId: 'inv-mp-1',
  });
  M.decideDte.mockReset().mockReturnValue({
    shouldIssue: false,
    documentKind: null,
    reason: 'test',
    idempotencyKey: 'idem-test',
  });
  M.tryAutoIssue.mockReset().mockResolvedValue({ ok: true, result: { ok: true, folio: 1001 } });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/checkout — Webpay invoice creation
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/checkout', () => {
  it('401 without auth token', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .send(validCheckout);
    expect(res.status).toBe(401);
  });

  it('400 on invalid tierId (empty)', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validCheckout, tierId: '' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/tierId/i);
  });

  it('400 on invalid cycle', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validCheckout, cycle: 'weekly' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/cycle/i);
  });

  it('400 on invalid currency', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validCheckout, currency: 'EUR' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/currency/i);
  });

  it('400 on invalid paymentMethod', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validCheckout, paymentMethod: 'stripe' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/paymentMethod/i);
  });

  it('400 when USD + webpay (business rule: USD requires manual-transfer)', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validCheckout, currency: 'USD', paymentMethod: 'webpay' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/USD requires manual-transfer/i);
  });

  it('400 on unknown tierId', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validCheckout, tierId: 'super-premium-xyz' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/tierId/i);
  });

  it('400 on invalid totalWorkers (negative)', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validCheckout, totalWorkers: -1 });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/totalWorkers/i);
  });

  it('400 on missing cliente.email', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validCheckout, cliente: { nombre: 'Test', rut: '12-K' } });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/cliente/i);
  });

  it('200 happy path — Webpay configured, creates invoice + returns paymentUrl', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .set('x-test-email', 'a@empresa.test')
      .send(validCheckout);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.invoiceId).toBeTruthy();
    expect(body.paymentUrl).toBe('https://webpay.test/start');
    expect(body.status).toBe('awaiting-payment');
    // Invoice persisted to Firestore
    const invoiceId = body.invoiceId as string;
    const stored = H.db!._store;
    const invoiceKey = `invoices/${invoiceId}`;
    expect(stored.has(invoiceKey)).toBe(true);
    const invoice = stored.get(invoiceKey) as Record<string, unknown>;
    expect(invoice.status).toBe('pending-payment');
    expect(invoice.createdBy).toBe('uid-A');
  });

  it('200 without cliente.rut — omits rut instead of persisting undefined (Firestore rejects undefined)', async () => {
    const { rut: _rut, ...clienteNoRut } = validCheckout.cliente as Record<string, unknown>;
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-R')
      .set('x-test-email', 'r@empresa.test')
      .send({ ...validCheckout, cliente: clienteNoRut });
    expect(res.status).toBe(200);
    const invoiceId = (res.body as Record<string, unknown>).invoiceId as string;
    const invoice = H.db!._store.get(`invoices/${invoiceId}`) as Record<string, any>;
    expect(invoice).toBeTruthy();
    // The real Firestore rejects `rut: undefined` ("Cannot use undefined as a
    // Firestore value"); the handler must OMIT the key, not write undefined.
    expect(Object.prototype.hasOwnProperty.call(invoice.cliente ?? {}, 'rut')).toBe(false);
  });

  it('200 manual-transfer checkout — status awaiting-payment, no paymentUrl', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-B')
      .send({ ...validCheckout, currency: 'USD', paymentMethod: 'manual-transfer' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('awaiting-payment');
    expect(body.paymentUrl).toBeUndefined();
  });

  it('200 — falls back to pending-config when Webpay adapter is NOT configured', async () => {
    M.webpayIsConfigured.mockReturnValue(false);
    const res = await request(buildApp())
      .post('/api/billing/checkout')
      .set('x-test-uid', 'uid-A')
      .send(validCheckout);
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('pending-config');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/invoice/:id/mark-paid — admin-only manual payment
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/invoice/:id/mark-paid', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-001/mark-paid');
    expect(res.status).toBe(401);
  });

  it('403 for non-admin caller — tier-gating reads customClaims.role SERVER-SIDE', async () => {
    // H.getUser returns no admin role by default
    H.db!._seed('invoices/inv-001', { status: 'pending-payment', totals: { total: 11990, currency: 'CLP' } });
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-001/mark-paid')
      .set('x-test-uid', 'uid-regular');
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toMatch(/admin role/i);
    // SECURITY: Invoice must NOT be marked paid
    const invoice = H.db!._store.get('invoices/inv-001') as Record<string, unknown>;
    expect(invoice.status).toBe('pending-payment');
  });

  it('400 on invalid invoice id format', async () => {
    // Make caller admin for this test
    H.getUser.mockImplementation(async (uid: string) => ({
      uid,
      customClaims: { role: 'admin' },
    }));
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv id with spaces!/mark-paid')
      .set('x-test-uid', 'uid-admin');
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/Invalid invoice id/i);
  });

  it('404 when invoice does not exist', async () => {
    H.getUser.mockImplementation(async (uid: string) => ({
      uid,
      customClaims: { role: 'admin' },
    }));
    const res = await request(buildApp())
      .post('/api/billing/invoice/nonexistent-inv/mark-paid')
      .set('x-test-uid', 'uid-admin');
    expect(res.status).toBe(404);
  });

  it('200 already-paid invoice returns alreadyPaid:true without double-write', async () => {
    H.getUser.mockImplementation(async (uid: string) => ({
      uid,
      customClaims: { role: 'admin' },
    }));
    H.db!._seed('invoices/inv-paid', { status: 'paid', totals: { total: 11990, currency: 'CLP' } });
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-paid/mark-paid')
      .set('x-test-uid', 'uid-admin');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).alreadyPaid).toBe(true);
  });

  it('409 on cancelled invoice', async () => {
    H.getUser.mockImplementation(async (uid: string) => ({
      uid,
      customClaims: { role: 'admin' },
    }));
    H.db!._seed('invoices/inv-cancelled', { status: 'cancelled', totals: { total: 11990, currency: 'CLP' } });
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-cancelled/mark-paid')
      .set('x-test-uid', 'uid-admin');
    expect(res.status).toBe(409);
  });

  it('200 happy path — invoice marked paid + audit_logs row written', async () => {
    H.getUser.mockImplementation(async (uid: string) => ({
      uid,
      customClaims: { role: 'admin' },
    }));
    H.db!._seed('invoices/inv-002', {
      status: 'pending-payment',
      totals: { total: 50000, currency: 'CLP' },
      createdBy: 'uid-owner',
    });
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-002/mark-paid')
      .set('x-test-uid', 'uid-admin')
      .set('x-test-email', 'admin@empresa.test');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).success).toBe(true);
    // Invoice must be paid
    const invoice = H.db!._store.get('invoices/inv-002') as Record<string, unknown>;
    expect(invoice.status).toBe('paid');
    expect(invoice.paymentSource).toBe('manual');
    // audit_logs entry must be written
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBeGreaterThanOrEqual(1);
    const auditRow = H.db!._store.get(auditKeys[0]) as Record<string, unknown>;
    expect(auditRow.action).toBe('billing.mark-paid');
    expect(auditRow.module).toBe('billing');
  });

  // ── B5/B15 — paridad de los 4 rieles (2026-06-11) ──────────────────────────
  // The MANUAL rail must deliver the same completion as webpay-return / MP
  // IPN / Khipu IPN: subscription activation + DTE attempt, exactly once.

  const seedB2bInvoice = (id = 'inv-b2b-1', cycle?: 'monthly' | 'annual') => {
    H.db!._seed(`invoices/${id}`, {
      status: 'pending-payment',
      createdBy: 'uid-owner',
      lineItems: [{ tierId: 'comite-paritario', description: 'Suscripción', quantity: 1, unitAmount: 42017, currency: 'CLP' }],
      totals: { subtotal: 42017, iva: 7983, total: 50000, currency: 'CLP' },
      cliente: { nombre: 'Empresa SpA', rut: '76.123.456-0', email: 'pagos@empresa.cl' },
      paymentMethod: 'manual-transfer',
      ...(cycle ? { cycle } : {}),
    });
  };
  const asAdmin = () => {
    H.getUser.mockImplementation(async (uid: string) => ({
      uid,
      customClaims: { role: 'admin' },
    }));
  };

  it('admin marks paid → owner subscription ACTIVATED from the invoice tier + audit row carries the outcome', async () => {
    asAdmin();
    seedB2bInvoice();
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-b2b-1/mark-paid')
      .set('x-test-uid', 'uid-admin')
      .set('x-test-email', 'admin@praeventio.net');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).success).toBe(true);
    expect((res.body as Record<string, unknown>).subscriptionActivation).toBe('activated');

    // Entitlement: users/{uid}.subscription mirrors the Khipu completed branch.
    const user = H.db!._store.get('users/uid-owner') as Record<string, any>;
    expect(user).toBeTruthy();
    expect(user.subscription.status).toBe('active');
    expect(user.subscription.tierId).toBe('comite-paritario');
    expect(user.subscription.paymentMethod).toBe('manual');
    expect(user.subscription.lastInvoiceId).toBe('inv-b2b-1');
    // Cycle is now persisted on the subscription doc; this invoice has no
    // structured cycle (legacy shape) so it falls back to the safe default.
    expect(user.subscription.cycle).toBe('monthly');

    // Audit row stamps identity from the VERIFIED token + activation outcome.
    const auditRows = [...H.db!._store.keys()]
      .filter((k) => k.startsWith('audit_logs/'))
      .map((k) => H.db!._store.get(k) as Record<string, unknown>);
    const row = auditRows.find((r) => r.action === 'billing.mark-paid');
    expect(row).toBeTruthy();
    expect(row!.userId).toBe('uid-admin');
    expect(row!.userEmail).toBe('admin@praeventio.net');
    const details = row!.details as Record<string, unknown>;
    expect(details.subscriptionActivation).toBe('activated');
    expect(details.ownerUid).toBe('uid-owner');
    expect(details.tierId).toBe('comite-paritario');
    expect(details.cycle).toBe('monthly');
  });

  it('round-trip: an annual invoice activates subscription.cycle === annual (cycle from server invoice, not the request)', async () => {
    asAdmin();
    seedB2bInvoice('inv-b2b-annual', 'annual');
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-b2b-annual/mark-paid')
      .set('x-test-uid', 'uid-admin')
      .set('x-test-email', 'admin@praeventio.net');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).subscriptionActivation).toBe('activated');
    const user = H.db!._store.get('users/uid-owner') as Record<string, any>;
    expect(user.subscription.cycle).toBe('annual');
    // The same server-derived cycle is stamped on the audit row (observability).
    const auditRow = [...H.db!._store.keys()]
      .filter((k) => k.startsWith('audit_logs/'))
      .map((k) => H.db!._store.get(k) as Record<string, any>)
      .find((r) => r.action === 'billing.mark-paid');
    expect(auditRow?.details?.cycle).toBe('annual');
  });

  it('warns billing_cycle_defaulted when an invoice has no derivable cycle (and NOT when it does)', async () => {
    asAdmin();
    // No cycle field + a description without a (monthly)/(annual) token → the
    // cycle is NOT derivable → defaulted → a warn so a wrong cycle is traceable.
    seedB2bInvoice('inv-no-cycle');
    vi.mocked(logger.warn).mockClear();
    await request(buildApp())
      .post('/api/billing/invoice/inv-no-cycle/mark-paid')
      .set('x-test-uid', 'uid-admin')
      .set('x-test-email', 'admin@praeventio.net');
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'billing_cycle_defaulted',
      expect.objectContaining({ rail: 'mark-paid', invoiceId: 'inv-no-cycle' }),
    );

    // A real cycle field → NO defaulted warn.
    seedB2bInvoice('inv-has-cycle', 'annual');
    vi.mocked(logger.warn).mockClear();
    await request(buildApp())
      .post('/api/billing/invoice/inv-has-cycle/mark-paid')
      .set('x-test-uid', 'uid-admin')
      .set('x-test-email', 'admin@praeventio.net');
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith(
      'billing_cycle_defaulted',
      expect.anything(),
    );
  });

  it('admin marks paid with shouldIssue decision → DTE emission ATTEMPTED via tryAutoIssueDte', async () => {
    asAdmin();
    seedB2bInvoice('inv-b2b-dte');
    M.decideDte.mockReturnValue({
      shouldIssue: true,
      documentKind: 'factura_electronica',
      reason: 'has_company_tax_id',
      idempotencyKey: 'idem-markpaid-dte',
      amountClp: 50000,
      paymentGateway: 'manual',
    });
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-b2b-dte/mark-paid')
      .set('x-test-uid', 'uid-admin');
    expect(res.status).toBe(200);
    expect(M.tryAutoIssue).toHaveBeenCalledTimes(1);
    const invoiceArg = M.tryAutoIssue.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(invoiceArg.id).toBe('inv-b2b-dte');
    expect(invoiceArg.status).toBe('paid');
    // Successful emission → nothing queued for retry.
    expect([...H.db!._store.keys()].some((k) => k.startsWith('dte_issue_queue/'))).toBe(false);
    // Audit row records the DTE outcome.
    const row = [...H.db!._store.keys()]
      .filter((k) => k.startsWith('audit_logs/'))
      .map((k) => H.db!._store.get(k) as Record<string, unknown>)
      .find((r) => r.action === 'billing.mark-paid');
    const dte = (row!.details as Record<string, any>).dte;
    expect(dte.shouldIssue).toBe(true);
    expect(dte.issued).toBe(true);
    expect(dte.folio).toBe(1001);
  });

  it('DTE provider DOWN → job persisted to dte_issue_queue (deterministic id), response still succeeds', async () => {
    asAdmin();
    seedB2bInvoice('inv-b2b-down');
    M.decideDte.mockReturnValue({
      shouldIssue: true,
      documentKind: 'factura_electronica',
      reason: 'has_company_tax_id',
      idempotencyKey: 'idem-markpaid-down',
      amountClp: 50000,
      paymentGateway: 'manual',
    });
    M.tryAutoIssue.mockResolvedValue({ ok: false, errorMessage: 'bsale 503' });

    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-b2b-down/mark-paid')
      .set('x-test-uid', 'uid-admin');
    // Fail-soft: the payment marking must never 500 because the PSE is down.
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).success).toBe(true);

    const queueDoc = H.db!._store.get('dte_issue_queue/idem-markpaid-down') as Record<string, any>;
    expect(queueDoc).toBeTruthy();
    expect(queueDoc.status).toBe('pending');
    expect(queueDoc.attempts).toBe(0);
    expect(queueDoc.source).toBe('mark-paid');
    expect(queueDoc.invoice.id).toBe('inv-b2b-down');
  });

  it('double-mark → activates exactly ONCE (second call replays alreadyPaid, no second DTE attempt)', async () => {
    asAdmin();
    seedB2bInvoice('inv-b2b-twice');
    M.decideDte.mockReturnValue({
      shouldIssue: true,
      documentKind: 'factura_electronica',
      reason: 'has_company_tax_id',
      idempotencyKey: 'idem-markpaid-twice',
      amountClp: 50000,
      paymentGateway: 'manual',
    });
    const app = buildApp();

    const first = await request(app)
      .post('/api/billing/invoice/inv-b2b-twice/mark-paid')
      .set('x-test-uid', 'uid-admin');
    expect(first.status).toBe(200);
    expect((first.body as Record<string, unknown>).subscriptionActivation).toBe('activated');
    expect(M.tryAutoIssue).toHaveBeenCalledTimes(1);

    const second = await request(app)
      .post('/api/billing/invoice/inv-b2b-twice/mark-paid')
      .set('x-test-uid', 'uid-admin');
    expect(second.status).toBe(200);
    expect((second.body as Record<string, unknown>).alreadyPaid).toBe(true);
    // No second activation / emission / audit success row.
    expect(M.tryAutoIssue).toHaveBeenCalledTimes(1);
    const markPaidRows = [...H.db!._store.keys()]
      .filter((k) => k.startsWith('audit_logs/'))
      .map((k) => H.db!._store.get(k) as Record<string, unknown>)
      .filter((r) => r.action === 'billing.mark-paid');
    expect(markPaidRows).toHaveLength(1);
    const user = H.db!._store.get('users/uid-owner') as Record<string, any>;
    expect(user.subscription.status).toBe('active');
  });

  it('409 when a concurrent mark-paid holds a FRESH in-progress lock (no double-activation race)', async () => {
    asAdmin();
    seedB2bInvoice('inv-b2b-race');
    // Simulate the other admin's request mid-flight.
    H.db!._seed('processed_markpaid/inv-b2b-race', {
      status: 'in_progress',
      lockedAtMs: Date.now(),
    });
    const res = await request(buildApp())
      .post('/api/billing/invoice/inv-b2b-race/mark-paid')
      .set('x-test-uid', 'uid-admin');
    expect(res.status).toBe(409);
    // Neither activation nor emission happened on this request.
    expect(H.db!._store.get('users/uid-owner')).toBeUndefined();
    expect(M.tryAutoIssue).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/billing/invoice/:id — status poll (auth + ownership gating)
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/billing/invoice/:id', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp()).get('/api/billing/invoice/inv-001');
    expect(res.status).toBe(401);
  });

  it('400 on invalid invoice id', async () => {
    const res = await request(buildApp())
      .get('/api/billing/invoice/this is invalid!')
      .set('x-test-uid', 'uid-A');
    expect(res.status).toBe(400);
  });

  it('404 when invoice not found', async () => {
    const res = await request(buildApp())
      .get('/api/billing/invoice/doesnotexist')
      .set('x-test-uid', 'uid-A');
    expect(res.status).toBe(404);
  });

  it('404 (not 403) when invoice belongs to another user — no existence leak', async () => {
    H.db!._seed('invoices/inv-other', {
      status: 'pending-payment',
      createdBy: 'uid-B',
      totals: { subtotal: 100, iva: 19, total: 119, currency: 'CLP' },
      issuedAt: new Date().toISOString(),
    });
    const res = await request(buildApp())
      .get('/api/billing/invoice/inv-other')
      .set('x-test-uid', 'uid-A'); // uid-A is not uid-B
    expect(res.status).toBe(404); // NOT 403 — prevents enumeration
  });

  it('200 returns safe fields only for invoice owner', async () => {
    H.db!._seed('invoices/inv-mine', {
      status: 'pending-payment',
      createdBy: 'uid-A',
      totals: { subtotal: 10075, iva: 1914, total: 11990, currency: 'CLP' },
      issuedAt: new Date().toISOString(),
      // These fields must NOT appear in the response
      webpayToken: 'SECRET-TOKEN',
      webpayAuthCode: 'SECRET-CODE',
      createdByEmail: 'a@empresa.test',
    });
    const res = await request(buildApp())
      .get('/api/billing/invoice/inv-mine')
      .set('x-test-uid', 'uid-A');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.id).toBe('inv-mine');
    expect(body.status).toBe('pending-payment');
    expect((body.totals as Record<string, unknown>).total).toBe(11990);
    // Sensitive fields must NOT be exposed
    expect(body.webpayToken).toBeUndefined();
    expect(body.webpayAuthCode).toBeUndefined();
    expect(body.createdByEmail).toBeUndefined();
  });

  it('200 paid invoice includes paidAt field', async () => {
    H.db!._seed('invoices/inv-paid2', {
      status: 'paid',
      createdBy: 'uid-A',
      totals: { subtotal: 10075, iva: 1914, total: 11990, currency: 'CLP' },
      issuedAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
    });
    const res = await request(buildApp())
      .get('/api/billing/invoice/inv-paid2')
      .set('x-test-uid', 'uid-A');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).paidAt).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/webhook — Google Play RTDN (shared-secret gate)
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/webhook (Google Play RTDN)', () => {
  const WEBHOOK_SECRET = 'test-webhook-secret-abc123';
  const validRtdnBody = {
    message: {
      messageId: 'msg-rtdn-1',
      data: Buffer.from(
        JSON.stringify({
          packageName: 'net.praeventio.guard',
          subscriptionNotification: {
            notificationType: 4,
            subscriptionId: 'praeventio.oro.monthly',
            purchaseToken: 'play-tok-1',
          },
        }),
      ).toString('base64'),
    },
  };

  beforeEach(() => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it('500 when WEBHOOK_SECRET not set (fail-closed)', async () => {
    delete process.env.WEBHOOK_SECRET;
    const res = await request(buildApp())
      .post('/api/billing/webhook')
      .query({ token: 'any' })
      .send(validRtdnBody);
    expect(res.status).toBe(500);
  });

  it('401 with wrong token (signature verification reject)', async () => {
    const res = await request(buildApp())
      .post('/api/billing/webhook')
      .query({ token: 'WRONG-SECRET' })
      .send(validRtdnBody);
    expect(res.status).toBe(401);
  });

  it('400 when message data is missing', async () => {
    const res = await request(buildApp())
      .post('/api/billing/webhook')
      .query({ token: WEBHOOK_SECRET })
      .send({ message: {} });
    expect(res.status).toBe(400);
  });

  it('200 happy path — valid token, processes and ACKs the message', async () => {
    const res = await request(buildApp())
      .post('/api/billing/webhook')
      .query({ token: WEBHOOK_SECRET })
      .send(validRtdnBody);
    expect(res.status).toBe(200);
    // Idempotency lock written to processed_pubsub
    const lockKey = 'processed_pubsub/msg-rtdn-1';
    expect(H.db!._store.has(lockKey)).toBe(true);
  });

  it('200 replayed message (duplicate) — does not reprocess', async () => {
    // Pre-seed the done lock so idempotency kicks in
    H.db!._seed('processed_pubsub/msg-rtdn-dup', {
      status: 'done',
      result: { ok: true },
      completedAtMs: Date.now(),
    });
    const res = await request(buildApp())
      .post('/api/billing/webhook')
      .query({ token: WEBHOOK_SECRET })
      .send({
        message: {
          messageId: 'msg-rtdn-dup',
          data: Buffer.from(JSON.stringify({})).toString('base64'),
        },
      });
    // ACKs 200 regardless
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/webhook/mercadopago — MP IPN (signature gate)
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/webhook/mercadopago', () => {
  it('401 when both OIDC and HMAC verification fail (bad signature)', async () => {
    M.mpOidc.mockResolvedValueOnce({ valid: false, reason: 'oidc-fail' });
    M.mpAnyFormat.mockReturnValueOnce(false);
    const res = await request(buildApp())
      .post('/api/billing/webhook/mercadopago')
      .send({ action: 'payment.updated', data: { id: 'pay-1' } });
    expect(res.status).toBe(401);
  });

  it('200 happy path — HMAC verified, processes IPN', async () => {
    const res = await request(buildApp())
      .post('/api/billing/webhook/mercadopago')
      .set('x-signature', 'ts=12345,v1=abc')
      .set('x-request-id', 'req-mp-1')
      .send({ action: 'payment.updated', data: { id: 'pay-mp-1' } });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
  });

  it('200 with OIDC Bearer auth — OIDC path takes precedence over HMAC', async () => {
    M.mpOidc.mockResolvedValueOnce({ valid: true });
    const res = await request(buildApp())
      .post('/api/billing/webhook/mercadopago')
      .set('Authorization', 'Bearer mp-jwt-token')
      .send({ action: 'payment.updated', data: { id: 'pay-oidc-1' } });
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/khipu/webhook — Khipu IPN (HMAC-SHA256 gate + idempotency)
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/khipu/webhook', () => {
  const khipuPayload = {
    payment_id: 'kh-pay-1',
    notification_id: 'kh-notif-1',
    status: 'done',
  };

  it('401 when Khipu signature verification fails (bad signature)', async () => {
    M.khipuVerify.mockReturnValueOnce(false);
    const res = await request(buildApp())
      .post('/api/billing/khipu/webhook')
      .set('Content-Type', 'application/json')
      .set('x-khipu-signature', 't=bad,s=badsig')
      .send(Buffer.from(JSON.stringify(khipuPayload)));
    expect(res.status).toBe(401);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_signature');
  });

  it('503 when Khipu is NOT configured — refuses to verify against the public sandbox secret', async () => {
    // Security: without real creds, fromEnv() falls back to the documented
    // PUBLIC sandbox secret → a forged signature could mark an invoice paid.
    // The handler must fail closed BEFORE verifying.
    M.khipuIsConfigured.mockReturnValueOnce(false);
    const res = await request(buildApp())
      .post('/api/billing/khipu/webhook')
      .set('Content-Type', 'application/json')
      .set('x-khipu-signature', 't=12345,s=anything')
      .send(Buffer.from(JSON.stringify(khipuPayload)));
    expect(res.status).toBe(503);
    expect((res.body as Record<string, unknown>).error).toBe('khipu_not_configured');
  });

  it('200 happy path — valid signature, payment completed, invoice paid', async () => {
    H.db!._seed('invoices/inv-khipu-1', { status: 'pending-payment' });
    const res = await request(buildApp())
      .post('/api/billing/khipu/webhook')
      .set('Content-Type', 'application/json')
      .set('x-khipu-signature', 't=12345,s=validhex')
      .send(JSON.stringify(khipuPayload));
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).received).toBe(true);
    // Invoice should be marked paid
    const invoice = H.db!._store.get('invoices/inv-khipu-1') as Record<string, unknown>;
    expect(invoice.status).toBe('paid');
    expect(invoice.paymentSource).toBe('khipu');
  });

  it('200 replayed Khipu webhook (idempotency) — invoice NOT double-paid', async () => {
    // Pre-seed the idempotency lock as done
    H.db!._seed('processed_khipu/kh-notif-replay', {
      status: 'done',
      result: { ok: true },
      completedAtMs: Date.now(),
    });
    H.db!._seed('invoices/inv-khipu-replay', { status: 'paid' }); // already paid
    const replayPayload = {
      payment_id: 'kh-pay-replay',
      notification_id: 'kh-notif-replay',
    };
    const res = await request(buildApp())
      .post('/api/billing/khipu/webhook')
      .set('Content-Type', 'application/json')
      .set('x-khipu-signature', 't=12345,s=validhex')
      .send(Buffer.from(JSON.stringify(replayPayload)));
    expect(res.status).toBe(200);
    // getPaymentStatus must NOT have been called (work() was skipped)
    expect(M.khipuGetStatus).not.toHaveBeenCalled();
  });

  it('200 Khipu cancelled payment → invoice rejected', async () => {
    M.khipuGetStatus.mockResolvedValueOnce({
      status: 'cancelled' as const,
      buyOrder: 'inv-khipu-cancel',
      amount: 30000,
      paymentId: 'kh-pay-cancel',
    });
    H.db!._seed('invoices/inv-khipu-cancel', { status: 'pending-payment' });
    const payload = { payment_id: 'kh-pay-cancel', notification_id: 'kh-notif-cancel' };
    const res = await request(buildApp())
      .post('/api/billing/khipu/webhook')
      .set('Content-Type', 'application/json')
      .set('x-khipu-signature', 't=12345,s=validhex')
      .send(JSON.stringify(payload));
    expect(res.status).toBe(200);
    const invoice = H.db!._store.get('invoices/inv-khipu-cancel') as Record<string, unknown>;
    expect(invoice.status).toBe('rejected');
  });

  // 2026-06-11 (khipu cableado) — webhook completion parity with the other
  // AUTOMATED rails (webpay return / MP IPN): a completed Khipu payment must
  // activate users/{uid}.subscription, not just mark the invoice paid.
  it('completed payment activates the owner subscription (paymentMethod khipu)', async () => {
    H.db!._seed('invoices/inv-khipu-1', {
      status: 'pending-payment',
      createdBy: 'uid-A',
      lineItems: [{ tierId: 'comite-paritario' }],
    });
    const res = await request(buildApp())
      .post('/api/billing/khipu/webhook')
      .set('Content-Type', 'application/json')
      .set('x-khipu-signature', 't=12345,s=validhex')
      .send(JSON.stringify(khipuPayload));
    expect(res.status).toBe(200);
    const user = H.db!._store.get('users/uid-A') as Record<string, any>;
    expect(user).toBeTruthy();
    expect(user.subscription.status).toBe('active');
    expect(user.subscription.tierId).toBe('comite-paritario');
    expect(user.subscription.paymentMethod).toBe('khipu');
    expect(user.subscription.lastInvoiceId).toBe('inv-khipu-1');
  });

  it('replayed webhook does NOT re-activate (idempotent — activation exactly once)', async () => {
    H.db!._seed('invoices/inv-khipu-1', {
      status: 'pending-payment',
      createdBy: 'uid-A',
      lineItems: [{ tierId: 'comite-paritario' }],
    });
    const app = buildApp();
    const first = await request(app)
      .post('/api/billing/khipu/webhook')
      .set('Content-Type', 'application/json')
      .set('x-khipu-signature', 't=12345,s=validhex')
      .send(JSON.stringify(khipuPayload));
    expect(first.status).toBe(200);
    expect(M.khipuGetStatus).toHaveBeenCalledTimes(1);

    const replay = await request(app)
      .post('/api/billing/khipu/webhook')
      .set('Content-Type', 'application/json')
      .set('x-khipu-signature', 't=12345,s=validhex')
      .send(JSON.stringify(khipuPayload));
    expect(replay.status).toBe(200);
    // work() skipped on replay → no second status fetch, no second activation.
    expect(M.khipuGetStatus).toHaveBeenCalledTimes(1);
    const user = H.db!._store.get('users/uid-A') as Record<string, any>;
    expect(user.subscription.status).toBe('active');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/khipu/checkout — Khipu payment creation (third automated
// rail; 2026-06-11 "khipu cableado")
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/khipu/checkout', () => {
  const validBody = { planId: 'plata', cycle: 'monthly' };

  it('401 without auth token', async () => {
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .send(validBody);
    expect(res.status).toBe(401);
    expect(M.khipuCreate).not.toHaveBeenCalled();
  });

  it('400 on missing planId', async () => {
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .set('x-test-uid', 'uid-A')
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/planId/i);
  });

  it('400 on unknown planId', async () => {
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .set('x-test-uid', 'uid-A')
      // cycle is now required (fail-closed); send a valid one so the planId
      // validation is what rejects, not the cycle guard.
      .send({ planId: 'super-premium-xyz', cycle: 'monthly' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/planId/i);
    expect(M.khipuCreate).not.toHaveBeenCalled();
  });

  it('400 when cycle is missing (fail-closed, no silent monthly default)', async () => {
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ planId: 'plata' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/cycle/i);
    expect(M.khipuCreate).not.toHaveBeenCalled();
  });

  it('400 on invalid cycle', async () => {
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ ...validBody, cycle: 'weekly' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/cycle/i);
  });

  it('503 honest when KHIPU_* credentials are absent (rule #13 — no stub disfrazado)', async () => {
    M.khipuIsConfigured.mockReturnValue(false);
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .set('x-test-uid', 'uid-A')
      .send(validBody);
    expect(res.status).toBe(503);
    expect((res.body as Record<string, unknown>).error).toMatch(/Khipu no está configurado/);
    expect(M.khipuCreate).not.toHaveBeenCalled();
  });

  it('200 happy path — amount is SERVER-computed (client-sent amount ignored), pending invoice + audit row persisted', async () => {
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .set('x-test-uid', 'uid-A')
      .set('x-test-email', 'cliente@empresa.cl')
      // Hostile client tries to pay $1 — the server must ignore it.
      .send({ ...validBody, amount: 1, totals: { total: 1 } });
    expect(res.status).toBe(200);

    const body = res.body as { invoiceId: string; paymentId: string; paymentUrl: string };
    expect(body.paymentId).toBe('kh-new-1');
    expect(body.paymentUrl).toBe('https://khipu.test/pay/kh-new-1');
    expect(body.invoiceId).toMatch(/^inv_khipu_/);

    // Adapter called with the canonical plata price:
    // net 16798 → IVA ceil → total 19990 CLP (BILLING_TIER_FALLBACK).
    expect(M.khipuCreate).toHaveBeenCalledTimes(1);
    const tx = M.khipuCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(tx.amount).toBe(19990);
    expect(tx.currency).toBe('CLP');
    expect(tx.buyOrder).toBe(body.invoiceId);
    expect(String(tx.notifyUrl)).toMatch(/\/api\/billing\/khipu\/webhook$/);
    expect(String(tx.returnUrl)).toContain('/pricing/success?invoice=');
    expect(String(tx.cancelUrl)).toContain('/pricing/failed?invoice=');

    // Pending invoice the webhook can correlate via buyOrder === invoiceId.
    const invoice = H.db!._store.get(`invoices/${body.invoiceId}`) as Record<string, any>;
    expect(invoice).toBeTruthy();
    expect(invoice.status).toBe('pending-payment');
    expect(invoice.paymentMethod).toBe('khipu');
    expect(invoice.createdBy).toBe('uid-A');
    expect(invoice.khipuPaymentId).toBe('kh-new-1');
    expect(invoice.totals.total).toBe(19990);
    expect(invoice.lineItems[0].tierId).toBe('plata');

    // Audit row with identity stamped from the verified token.
    const auditRows = [...H.db!._store.keys()]
      .filter((k) => k.startsWith('audit_logs/'))
      .map((k) => H.db!._store.get(k) as Record<string, unknown>);
    const row = auditRows.find((r) => r.action === 'billing.khipu.payment.created');
    expect(row).toBeTruthy();
    expect(row!.userId).toBe('uid-A');
    expect(row!.userEmail).toBe('cliente@empresa.cl');
    expect((row!.details as Record<string, unknown>).amount).toBe(19990);
  });

  it('annual cycle computes the annual CLP total server-side', async () => {
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .set('x-test-uid', 'uid-A')
      .send({ planId: 'plata', cycle: 'annual' });
    expect(res.status).toBe(200);
    const tx = M.khipuCreate.mock.calls[0]![0] as Record<string, unknown>;
    // net anual 151185 → ceil(151185 * 1.19) = 179911.
    expect(tx.amount).toBe(179911);
  });

  it('502 when the Khipu API rejects payment creation', async () => {
    const { KhipuAdapterError } = await import('../../services/billing/khipuAdapter.js');
    M.khipuCreate.mockRejectedValueOnce(new KhipuAdapterError('createPayment', 'Khipu returned 400', 400));
    const res = await request(buildApp())
      .post('/api/billing/khipu/checkout')
      .set('x-test-uid', 'uid-A')
      .send(validBody);
    expect(res.status).toBe(502);
    // No internals leaked.
    expect(JSON.stringify(res.body)).not.toContain('Khipu returned 400');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /billing/webpay/return — Webpay return handler
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /billing/webpay/return', () => {
  it('400 on missing token_ws', async () => {
    const res = await request(buildApp()).get('/billing/webpay/return');
    expect(res.status).toBe(400);
  });

  it('400 on invalid token_ws format', async () => {
    const res = await request(buildApp()).get('/billing/webpay/return?token_ws=bad token!');
    expect(res.status).toBe(400);
  });

  it('302 → /pricing/failed when Webpay is NOT configured (no commit on sandbox creds)', async () => {
    M.webpayIsConfigured.mockReturnValue(false);
    const res = await request(buildApp())
      .get('/billing/webpay/return?token_ws=tok-unconfigured')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/pricing\/failed/);
    // Must NOT have attempted a commit against sandbox/default creds.
    expect(M.webpayCommit).not.toHaveBeenCalled();
  });

  it('302 → /pricing/success on AUTHORIZED commit', async () => {
    M.webpayCommit.mockResolvedValueOnce({
      status: 'AUTHORIZED' as const,
      buyOrder: 'inv-webpay-auth',
      amount: 11990,
      authorizationCode: 'AUTH-OK',
      cardLast4: '6623',
    });
    H.db!._seed('invoices/inv-webpay-auth', {
      status: 'pending-payment',
      createdBy: 'uid-A',
      cycle: 'annual',
      lineItems: [{ tierId: 'comite-paritario' }],
    });
    const res = await request(buildApp())
      .get('/billing/webpay/return?token_ws=tok-auth-1')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/pricing\/success/);
    const invoice = H.db!._store.get('invoices/inv-webpay-auth') as Record<string, unknown>;
    expect(invoice.status).toBe('paid');
    expect(invoice.paymentSource).toBe('webpay');
    // audit_logs row written, stamping the server-derived billing cycle.
    const authRow = [...H.db!._store.keys()]
      .filter((k) => k.startsWith('audit_logs/'))
      .map((k) => H.db!._store.get(k) as Record<string, any>)
      .find((r) => r.action === 'billing.webpay-return.authorized');
    expect(authRow).toBeTruthy();
    expect(authRow!.details.cycle).toBe('annual');
  });

  it('302 → /pricing/failed on REJECTED commit', async () => {
    M.webpayCommit.mockResolvedValueOnce({
      status: 'REJECTED' as const,
      buyOrder: 'inv-webpay-rej',
      amount: 11990,
    });
    H.db!._seed('invoices/inv-webpay-rej', { status: 'pending-payment', createdBy: 'uid-A' });
    const res = await request(buildApp())
      .get('/billing/webpay/return?token_ws=tok-rej-1')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/pricing\/failed/);
    const invoice = H.db!._store.get('invoices/inv-webpay-rej') as Record<string, unknown>;
    expect(invoice.status).toBe('rejected');
  });

  it('302 → /pricing/retry on FAILED commit (transient)', async () => {
    M.webpayCommit.mockResolvedValueOnce({
      status: 'FAILED' as const,
      buyOrder: 'inv-webpay-fail',
      amount: 11990,
    });
    H.db!._seed('invoices/inv-webpay-fail', { status: 'pending-payment', createdBy: 'uid-A' });
    const res = await request(buildApp())
      .get('/billing/webpay/return?token_ws=tok-fail-1')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/pricing\/retry/);
    // Invoice must stay pending-payment (transient — not rejected)
    const invoice = H.db!._store.get('invoices/inv-webpay-fail') as Record<string, unknown>;
    expect(invoice.status).toBe('pending-payment');
  });

  it('replayed token_ws (lock already done) → replays original redirect', async () => {
    M.acquireWebpayLock.mockResolvedValueOnce({
      acquired: false,
      alreadyDone: true,
      outcome: 'paid' as const,
      invoiceId: 'inv-replay-ok',
    });
    const res = await request(buildApp())
      .get('/billing/webpay/return?token_ws=tok-replay-1')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/pricing\/success.*inv-replay-ok/);
    // commitTransaction must NOT be called again
    expect(M.webpayCommit).not.toHaveBeenCalled();
  });

  it('in-flight token → 302 to /pricing/success (optimistic, SPA will poll)', async () => {
    M.acquireWebpayLock.mockResolvedValueOnce({ acquired: false });
    const res = await request(buildApp())
      .get('/billing/webpay/return?token_ws=tok-inflight')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/success');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/checkout/mercadopago — MercadoPago LATAM checkout
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/checkout/mercadopago', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout/mercadopago')
      .send({ tierKey: 'oro', billingCycle: 'monthly', country: 'PE', currency: 'PEN' });
    expect(res.status).toBe(401);
  });

  it('503 when MP adapter not configured', async () => {
    M.mpIsConfigured.mockReturnValueOnce(false);
    const res = await request(buildApp())
      .post('/api/billing/checkout/mercadopago')
      .set('x-test-uid', 'uid-A')
      .send({ tierKey: 'oro', billingCycle: 'monthly', country: 'PE', currency: 'PEN' });
    expect(res.status).toBe(503);
  });

  it('400 on invalid country', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout/mercadopago')
      .set('x-test-uid', 'uid-A')
      .send({ tierKey: 'oro', billingCycle: 'monthly', country: 'CL', currency: 'CLP' });
    // CL is not in the MP country list (CL uses Webpay)
    expect(res.status).toBe(400);
  });

  it('400 on mismatched country/currency', async () => {
    const res = await request(buildApp())
      .post('/api/billing/checkout/mercadopago')
      .set('x-test-uid', 'uid-A')
      .send({ tierKey: 'oro', billingCycle: 'monthly', country: 'PE', currency: 'BRL' });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/verify — Google Play one-shot verify
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/verify', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/billing/verify')
      .send({ purchaseToken: 'tok', productId: 'oro', type: 'subscription' });
    expect(res.status).toBe(401);
  });

  it('500 when Play API not configured (no GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)', async () => {
    // The env var is not set in tests — playAuth is null
    const res = await request(buildApp())
      .post('/api/billing/verify')
      .set('x-test-uid', 'uid-A')
      .send({ purchaseToken: 'tok', productId: 'oro', type: 'subscription' });
    // Route returns 500 with "Google Play API not configured" when playAuth is null
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toMatch(/Google Play/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/google-play/validate-receipt
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/google-play/validate-receipt', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/billing/google-play/validate-receipt')
      .send({ productId: 'oro', receiptId: 'tok-1' });
    expect(res.status).toBe(401);
  });

  it('400 when productId or receiptId missing', async () => {
    const res = await request(buildApp())
      .post('/api/billing/google-play/validate-receipt')
      .set('x-test-uid', 'uid-A')
      .send({ productId: 'oro' }); // no receiptId
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('missing_fields');
  });

  it('200 happy path — valid receipt returns ok:true', async () => {
    const { validateGooglePlaySubscription } = await import('../../services/billing/googlePlayValidator.js');
    (validateGooglePlaySubscription as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      productId: 'praeventio.oro.monthly',
      expiryMs: Date.now() + 1000000,
      regionCode: 'CL',
      subscriptionState: 'active',
    });
    const res = await request(buildApp())
      .post('/api/billing/google-play/validate-receipt')
      .set('x-test-uid', 'uid-A')
      .send({ productId: 'praeventio.oro.monthly', receiptId: 'tok-gp-1' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
  });

  it('400 on rejected receipt (token_invalid)', async () => {
    const { validateGooglePlaySubscription } = await import('../../services/billing/googlePlayValidator.js');
    (validateGooglePlaySubscription as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: 'token_invalid' as const,
      detail: 'token not found in Play',
    });
    const res = await request(buildApp())
      .post('/api/billing/google-play/validate-receipt')
      .set('x-test-uid', 'uid-A')
      .send({ productId: 'praeventio.oro.monthly', receiptId: 'bad-tok' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).reason).toBe('token_invalid');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/app-store/validate-receipt
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/app-store/validate-receipt', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/billing/app-store/validate-receipt')
      .send({ productId: 'oro', receiptId: 'txn-1' });
    expect(res.status).toBe(401);
  });

  it('400 when fields missing', async () => {
    const res = await request(buildApp())
      .post('/api/billing/app-store/validate-receipt')
      .set('x-test-uid', 'uid-A')
      .send({ receiptId: 'txn-1' }); // no productId
    expect(res.status).toBe(400);
  });

  it('200 happy path — valid Apple transaction', async () => {
    const { validateAppleTransaction } = await import('../../services/billing/appleTransactionValidator.js');
    (validateAppleTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      productId: 'praeventio.oro.monthly',
      expiryMs: Date.now() + 1000000,
      environment: 'Sandbox',
      originalTransactionId: 'orig-1',
    });
    const res = await request(buildApp())
      .post('/api/billing/app-store/validate-receipt')
      .set('x-test-uid', 'uid-A')
      .send({ productId: 'praeventio.oro.monthly', receiptId: 'txn-apple-1' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
  });

  it('400 on rejected Apple transaction (expired)', async () => {
    const { validateAppleTransaction } = await import('../../services/billing/appleTransactionValidator.js');
    (validateAppleTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: 'expired' as const,
      detail: 'subscription expired',
    });
    const res = await request(buildApp())
      .post('/api/billing/app-store/validate-receipt')
      .set('x-test-uid', 'uid-A')
      .send({ productId: 'praeventio.oro.monthly', receiptId: 'old-txn' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).reason).toBe('expired');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/webhook/apple — Apple SSN v2
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/billing/webhook/apple', () => {
  it('400 when signedPayload missing (Zod guard)', async () => {
    const res = await request(buildApp())
      .post('/api/billing/webhook/apple')
      .send({ wrong: 'field' });
    expect(res.status).toBe(400);
  });

  it('401 when JWS verification fails (AppleSsnVerificationError)', async () => {
    const { verifyAndDecodeAppleSsn, AppleSsnVerificationError } = await import('../../services/billing/appleSsn.js');
    (verifyAndDecodeAppleSsn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new (AppleSsnVerificationError as new (msg: string) => Error)('bad signature'),
    );
    const res = await request(buildApp())
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: 'bad.jws.token' });
    expect(res.status).toBe(401);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_signature');
  });

  it('200 happy path — valid Apple SSN webhook ACKed', async () => {
    const res = await request(buildApp())
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: 'valid.jws.token' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    // Idempotency lock written to processed_apple_ssn
    expect(H.db!._store.has('processed_apple_ssn/apple-uuid-1')).toBe(true);
  });

  it('200 replayed Apple SSN (duplicate notificationUUID) — work skipped', async () => {
    H.db!._seed('processed_apple_ssn/apple-uuid-1', {
      status: 'done',
      result: { ok: true, action: 'subscription_renewed', userId: 'uid-A' },
      completedAtMs: Date.now(),
    });
    const res = await request(buildApp())
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: 'valid.jws.token' });
    expect(res.status).toBe(200);
  });
});
