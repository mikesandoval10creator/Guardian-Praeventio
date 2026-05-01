// Praeventio Guard — Round 15 (I3 / A6): Billing endpoints HTTP tests.
//
// Covers 5 billing routes — most of the surface area Round 13/14
// added but had ZERO HTTP tests for:
//   • POST /api/billing/verify    — Google Play purchase verification
//   • POST /api/billing/checkout  — Webpay invoice creation
//   • GET  /api/billing/invoice/:id — invoice polling endpoint
//   • POST /api/billing/webhook   — RTDN with shared secret + idempotency
//   • GET  /billing/webpay/return — Webpay return handler (5 exit branches)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

describe('POST /api/billing/verify', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
  });

  it('returns 401 unauthenticated', async () => {
    handle = buildTestServer({ firestore: fs, playVerify: async () => ({ data: {} }) });
    const res = await request(handle.app)
      .post('/api/billing/verify')
      .send({ purchaseToken: 't', productId: 'comite', type: 'subscription' });
    expect(res.status).toBe(401);
  });

  it('returns 500 when Google Play API is not configured', async () => {
    handle = buildTestServer({ firestore: fs }); // no playVerify
    const res = await request(handle.app)
      .post('/api/billing/verify')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ purchaseToken: 't', productId: 'comite', type: 'subscription' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Google Play/);
  });

  it('happy path: subscription verify writes transaction + updates user', async () => {
    const playVerify = vi.fn(async () => ({
      data: {
        orderId: 'GPA.0000-1111',
        paymentState: 1,
        expiryTimeMillis: String(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    }));
    handle = buildTestServer({ firestore: fs, playVerify });
    // Seed a users doc so update() has a target
    fs.store.set('users/uid-A', { name: 'Alice' });
    const res = await request(handle.app)
      .post('/api/billing/verify')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ purchaseToken: 'tok-1', productId: 'oro', type: 'subscription' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(playVerify).toHaveBeenCalled();
    // Transaction logged
    const txKey = [...fs.store.keys()].find((k) => k.startsWith('transactions/'));
    expect(txKey).toBeDefined();
    expect(fs.store.get(txKey!)).toMatchObject({ userId: 'uid-A', productId: 'oro' });
    // User subscription updated to active oro
    expect(fs.store.get('users/uid-A')).toMatchObject({
      subscription: { planId: 'oro', status: 'active' },
    });
  });

  it('falls back to "comite" plan when productId is unknown', async () => {
    const playVerify = vi.fn(async () => ({ data: { paymentState: 1 } }));
    handle = buildTestServer({ firestore: fs, playVerify });
    fs.store.set('users/uid-A', {});
    await request(handle.app)
      .post('/api/billing/verify')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ purchaseToken: 't', productId: 'made-up-plan', type: 'subscription' });
    expect((fs.store.get('users/uid-A') as any).subscription.planId).toBe('comite');
  });
});

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs });
  });

  it('returns 401 unauthenticated', async () => {
    const res = await request(handle.app).post('/api/billing/checkout').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing tierId', async () => {
    const res = await request(handle.app)
      .post('/api/billing/checkout')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tierId/);
  });

  it('returns 400 when CLP currency is paired with stripe', async () => {
    const res = await request(handle.app)
      .post('/api/billing/checkout')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({
        tierId: 'comite-paritario',
        cycle: 'monthly',
        currency: 'CLP',
        paymentMethod: 'stripe',
        totalWorkers: 10,
        totalProjects: 1,
        cliente: { nombre: 'Cliente Test', email: 'c@test.com' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CLP/);
  });

  it('returns 400 for unknown tierId', async () => {
    const res = await request(handle.app)
      .post('/api/billing/checkout')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({
        tierId: 'galactic-empire',
        cycle: 'monthly',
        currency: 'CLP',
        paymentMethod: 'webpay',
        totalWorkers: 10,
        totalProjects: 1,
        cliente: { nombre: 'X', email: 'x@y.cl' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tierId/);
  });

  it('happy path: webpay checkout writes invoice doc and returns paymentUrl', async () => {
    const res = await request(handle.app)
      .post('/api/billing/checkout')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({
        tierId: 'comite-paritario',
        cycle: 'monthly',
        currency: 'CLP',
        paymentMethod: 'webpay',
        totalWorkers: 10,
        totalProjects: 1,
        cliente: { nombre: 'ACME SpA', email: 'cfo@acme.cl', rut: '76123456-7' },
      });
    expect(res.status).toBe(200);
    expect(res.body.invoiceId).toBeTruthy();
    expect(res.body.paymentUrl).toContain('webpay');
    expect(res.body.status).toBe('awaiting-payment');
    // Invoice doc persisted
    const invoiceKey = `invoices/${res.body.invoiceId}`;
    expect(fs.store.has(invoiceKey)).toBe(true);
    expect(fs.store.get(invoiceKey)).toMatchObject({
      status: 'pending-payment',
      createdBy: 'uid-A',
    });
  });
});

describe('GET /api/billing/invoice/:id', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs });
  });

  it('returns 401 unauthenticated', async () => {
    const res = await request(handle.app).get('/api/billing/invoice/inv_123');
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed id', async () => {
    const res = await request(handle.app)
      .get('/api/billing/invoice/has spaces!')
      .set('Authorization', 'Bearer test:uid-A:a@test.com');
    expect(res.status).toBe(400);
  });

  it('returns 404 when invoice does not exist', async () => {
    const res = await request(handle.app)
      .get('/api/billing/invoice/inv_ghost')
      .set('Authorization', 'Bearer test:uid-A:a@test.com');
    expect(res.status).toBe(404);
  });

  it('returns 404 (NOT 403) when invoice belongs to a different user', async () => {
    // Anti-enumeration: 404 is deliberate so attackers can't probe ids.
    fs.store.set('invoices/inv_other', {
      createdBy: 'uid-other',
      status: 'pending-payment',
      totals: { subtotal: 100, iva: 19, total: 119, currency: 'CLP' },
    });
    const res = await request(handle.app)
      .get('/api/billing/invoice/inv_other')
      .set('Authorization', 'Bearer test:uid-A:a@test.com');
    expect(res.status).toBe(404);
  });

  it('happy path: owner reads their invoice with safe fields only', async () => {
    fs.store.set('invoices/inv_mine', {
      createdBy: 'uid-A',
      status: 'paid',
      paidAt: '2026-04-28T00:00:00.000Z',
      totals: { subtotal: 10075, iva: 1915, total: 11990, currency: 'CLP' },
      // Sensitive fields that must NOT leak:
      webpayToken: 'leak-token',
      webpayAuthCode: 'leak-auth',
      lineItems: [{ secret: 'should not leak' }],
    });
    const res = await request(handle.app)
      .get('/api/billing/invoice/inv_mine')
      .set('Authorization', 'Bearer test:uid-A:a@test.com');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('inv_mine');
    expect(res.body.status).toBe('paid');
    expect(res.body.totals.total).toBe(11990);
    expect(res.body.emisorRut).toBe('78231119-0');
    expect(res.body.webpayToken).toBeUndefined();
    expect(res.body.lineItems).toBeUndefined();
  });
});

describe('POST /api/billing/webhook', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs, webhookSecret: 'sekret' });
  });

  it('returns 401 with no token', async () => {
    const res = await request(handle.app)
      .post('/api/billing/webhook')
      .send({ message: { data: 'x' } });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong token', async () => {
    const res = await request(handle.app)
      .post('/api/billing/webhook?token=wrong')
      .send({ message: { data: 'x' } });
    expect(res.status).toBe(401);
  });

  it('returns 400 when message data is missing', async () => {
    const res = await request(handle.app)
      .post('/api/billing/webhook?token=sekret')
      .send({ message: {} });
    expect(res.status).toBe(400);
  });

  it('returns 200 (and skips persistence) when messageId is missing', async () => {
    const data = Buffer.from(JSON.stringify({ subscriptionNotification: {} })).toString('base64');
    const res = await request(handle.app)
      .post('/api/billing/webhook?token=sekret')
      .send({ message: { data } });
    expect(res.status).toBe(200);
    // No idempotency doc created (no messageId)
    expect([...fs.store.keys()].some((k) => k.startsWith('processed_pubsub/'))).toBe(false);
  });

  it('happy path: ACKs 200 and persists processed_pubsub idempotency doc', async () => {
    const data = Buffer.from(
      JSON.stringify({ subscriptionNotification: { purchaseToken: 'tok-X' } }),
    ).toString('base64');
    const res = await request(handle.app)
      .post('/api/billing/webhook?token=sekret')
      .send({ message: { data, messageId: 'msg-1' } });
    expect(res.status).toBe(200);
    expect(fs.store.get('processed_pubsub/msg-1')).toMatchObject({ status: 'done' });
  });

  it('idempotency: redelivered messageId is a no-op (still 200)', async () => {
    const data = Buffer.from(JSON.stringify({ subscriptionNotification: {} })).toString('base64');
    // First delivery
    await request(handle.app)
      .post('/api/billing/webhook?token=sekret')
      .send({ message: { data, messageId: 'msg-2' } });
    // Second delivery — should still 200 without re-running.
    const res = await request(handle.app)
      .post('/api/billing/webhook?token=sekret')
      .send({ message: { data, messageId: 'msg-2' } });
    expect(res.status).toBe(200);
  });
});

describe('GET /billing/webpay/return', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
  });

  it('returns 400 on missing or malformed token_ws', async () => {
    handle = buildTestServer({ firestore: fs });
    const res1 = await request(handle.app).get('/billing/webpay/return');
    expect(res1.status).toBe(400);
    const res2 = await request(handle.app).get('/billing/webpay/return?token_ws=has spaces');
    expect(res2.status).toBe(400);
  });

  it('AUTHORIZED → invoice marked paid, redirect /pricing/success', async () => {
    handle = buildTestServer({
      firestore: fs,
      webpayCommit: async () => ({
        status: 'AUTHORIZED',
        buyOrder: 'inv_OK',
        amount: 11990,
        authorizationCode: 'AUTH-OK',
      }),
    });
    fs.store.set('invoices/inv_OK', { status: 'pending-payment', createdBy: 'uid-A' });
    const res = await request(handle.app).get('/billing/webpay/return?token_ws=tok-OK');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/success?invoice=inv_OK');
    expect((fs.store.get('invoices/inv_OK') as any).status).toBe('paid');
    // Audit row emitted
    expect(fs.audit.some((e) => e.action === 'billing.webpay-return.authorized')).toBe(true);
  });

  it('REJECTED → invoice marked rejected, redirect /pricing/failed', async () => {
    handle = buildTestServer({
      firestore: fs,
      webpayCommit: async () => ({ status: 'REJECTED', buyOrder: 'inv_NO', amount: 11990 }),
    });
    fs.store.set('invoices/inv_NO', { status: 'pending-payment', createdBy: 'uid-A' });
    const res = await request(handle.app).get('/billing/webpay/return?token_ws=tok-NO');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/failed?invoice=inv_NO');
    expect((fs.store.get('invoices/inv_NO') as any).status).toBe('rejected');
  });

  it('FAILED → invoice stays pending-payment, redirect /pricing/retry', async () => {
    handle = buildTestServer({
      firestore: fs,
      webpayCommit: async () => ({ status: 'FAILED', buyOrder: 'inv_TR', amount: 11990 }),
    });
    fs.store.set('invoices/inv_TR', { status: 'pending-payment', createdBy: 'uid-A' });
    const res = await request(handle.app).get('/billing/webpay/return?token_ws=tok-TR');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/retry?invoice=inv_TR');
    expect((fs.store.get('invoices/inv_TR') as any).status).toBe('pending-payment');
  });

  it('idempotency replay: redelivered token_ws redirects to original outcome', async () => {
    handle = buildTestServer({
      firestore: fs,
      webpayCommit: async () => ({
        status: 'AUTHORIZED',
        buyOrder: 'inv_RE',
        amount: 11990,
        authorizationCode: 'A',
      }),
    });
    fs.store.set('invoices/inv_RE', { status: 'pending-payment', createdBy: 'uid-A' });
    // First call
    await request(handle.app).get('/billing/webpay/return?token_ws=tok-RE');
    // Second call — should replay redirect WITHOUT a second commit.
    let secondCommitCalls = 0;
    handle = buildTestServer({
      firestore: fs, // share state
      webpayCommit: async () => {
        secondCommitCalls++;
        return { status: 'AUTHORIZED', buyOrder: 'inv_RE', amount: 11990 };
      },
    });
    const res = await request(handle.app).get('/billing/webpay/return?token_ws=tok-RE');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/success?invoice=inv_RE');
    expect(secondCommitCalls).toBe(0);
  });

  it('exception path: webpay commit throws → redirect to /pricing/failed?error=webpay', async () => {
    handle = buildTestServer({
      firestore: fs,
      webpayCommit: async () => {
        throw new Error('transbank exploded');
      },
    });
    const res = await request(handle.app).get('/billing/webpay/return?token_ws=tok-BOOM');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/failed?error=webpay');
  });
});
