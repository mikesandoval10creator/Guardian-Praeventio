// Praeventio Guard — Round 18 R2 (deferred from R17): MercadoPago IPN
// HTTP-layer supertest harness.
//
// Mirrors src/__tests__/server/telemetryRotation.test.ts pattern: build a
// minimal Express app that wires the same handler shape as the production
// `billingApiRouter` route at POST /api/billing/webhook/mercadopago.
// Production handler lives in src/server/routes/billing.ts; we cannot mount
// the real router here because it pulls in firebase-admin singleton init.
//
// Test surface:
//   1. 401 when signature is missing/invalid
//   2. 200 happy path (status=approved → outcome=paid)
//   3. 200 idempotent replay (second delivery doesn't double-process)
//   4. 500 when MP API getPayment() throws
//   5. 200 ack for non-payment notification types

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';

import { InMemoryFirestore, fakeFieldValue } from './test-server.js';
import { verifyMercadoPagoIpnSignatureFromBody } from '../../services/billing/mercadoPagoIpn.js';
import { canonicalize } from '../../server/middleware/canonicalBody.js';

const IPN_SECRET = 'mp-ipn-secret-supertest';

// Round 18 R6: signing input is the RFC 8785 canonical-JSON form of the
// parsed body, not JSON.stringify. This helper mirrors what a correctly-
// implemented MP-side producer (or any non-Node integrator) MUST do.
function signBody(body: unknown): string {
  const raw = canonicalize(body ?? {});
  const hex = crypto.createHmac('sha256', IPN_SECRET).update(raw).digest('hex');
  return `sha256=${hex}`;
}

interface FakePayment {
  status: string;
  status_detail?: string;
  external_reference?: string;
}

interface Deps {
  fs: InMemoryFirestore;
  /** MP getPayment stub (id → fake response). */
  getPayment: (id: string) => Promise<FakePayment>;
}

function buildApp(deps: Deps): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  type IpnOutcome = 'paid' | 'rejected' | 'pending';

  function mapStatus(status: string): IpnOutcome {
    if (status === 'approved') return 'paid';
    if (
      status === 'rejected' ||
      status === 'cancelled' ||
      status === 'refunded' ||
      status === 'charged_back'
    ) {
      return 'rejected';
    }
    return 'pending';
  }

  app.post('/api/billing/webhook/mercadopago', async (req, res) => {
    const signature = req.header('x-signature') ?? '';
    if (!verifyMercadoPagoIpnSignatureFromBody(req.body ?? {}, signature, IPN_SECRET)) {
      return res.status(401).send('Invalid signature');
    }

    const body = req.body ?? {};
    if (body.type !== 'payment') {
      // ACK 200 to suppress retries; non-payment types are no-ops.
      return res.status(200).json({ ok: true, outcome: 'pending', invoiceId: '' });
    }

    const paymentId = body.data?.id;
    if (typeof paymentId !== 'string' || paymentId.length === 0) {
      return res.status(500).send('IPN processing failed');
    }

    // Idempotency check: if processed_mp_ipn/{paymentId} exists with
    // status='done', replay the captured outcome.
    const lockRef = deps.fs.collection('processed_mp_ipn').doc(paymentId);
    const lockSnap = await lockRef.get();
    if (lockSnap.exists && (lockSnap.data() as any)?.status === 'done') {
      const result = (lockSnap.data() as any)?.result ?? { outcome: 'pending', invoiceId: '' };
      return res.status(200).json({ ok: true, ...result });
    }

    try {
      const payment = await deps.getPayment(paymentId);
      const outcome = mapStatus(payment.status);
      const invoiceId = payment.external_reference ?? '';

      // Update invoice doc.
      if (invoiceId) {
        const invoiceRef = deps.fs.collection('invoices').doc(invoiceId);
        if (outcome === 'paid') {
          await invoiceRef.set(
            {
              status: 'paid',
              paidAt: fakeFieldValue.serverTimestamp(),
              paymentSource: 'mercadopago',
              mercadoPagoPaymentId: paymentId,
            },
            { merge: true },
          );
        } else if (outcome === 'rejected') {
          await invoiceRef.set(
            { status: 'rejected', paymentSource: 'mercadopago' },
            { merge: true },
          );
        }
      }

      // Audit row.
      await deps.fs.collection('audit_logs').add({
        action: 'billing.mercadopago.ipn.processed',
        module: 'billing',
        details: { paymentId, outcome, invoiceId },
      });

      // Mark idempotency doc done.
      await lockRef.set({ status: 'done', result: { outcome, invoiceId } });

      return res.status(200).json({ ok: true, outcome, invoiceId });
    } catch {
      return res.status(500).send('IPN processing failed');
    }
  });

  return app;
}

let fs: InMemoryFirestore;

beforeEach(() => {
  fs = new InMemoryFirestore();
});

describe('POST /api/billing/webhook/mercadopago', () => {
  it('returns 401 when the signature is missing', async () => {
    const app = buildApp({ fs, getPayment: vi.fn() });
    const res = await request(app)
      .post('/api/billing/webhook/mercadopago')
      .send({ type: 'payment', data: { id: 'pay_1' } });
    expect(res.status).toBe(401);
  });

  it('returns 401 when the signature does not match', async () => {
    const app = buildApp({ fs, getPayment: vi.fn() });
    const res = await request(app)
      .post('/api/billing/webhook/mercadopago')
      .set('x-signature', 'sha256=' + 'a'.repeat(64))
      .send({ type: 'payment', data: { id: 'pay_1' } });
    expect(res.status).toBe(401);
  });

  it('returns 200 + marks invoice paid on the happy path (status=approved)', async () => {
    const invoiceId = 'inv_mp_happy';
    fs.store.set(`invoices/${invoiceId}`, {
      id: invoiceId,
      status: 'pending-payment',
      paymentMethod: 'mercadopago',
    });
    const getPayment = vi.fn(async (_id: string) => ({
      status: 'approved',
      status_detail: 'accredited',
      external_reference: invoiceId,
    }));

    const app = buildApp({ fs, getPayment });
    const body = { type: 'payment', data: { id: 'pay_happy' } };
    const res = await request(app)
      .post('/api/billing/webhook/mercadopago')
      .set('x-signature', signBody(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, outcome: 'paid', invoiceId });
    expect((fs.store.get(`invoices/${invoiceId}`) as any).status).toBe('paid');
    expect(getPayment).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on replay (second delivery does not re-fetch)', async () => {
    const invoiceId = 'inv_mp_replay';
    fs.store.set(`invoices/${invoiceId}`, {
      id: invoiceId,
      status: 'pending-payment',
      paymentMethod: 'mercadopago',
    });
    const getPayment = vi.fn(async (_id: string) => ({
      status: 'approved',
      external_reference: invoiceId,
    }));

    const app = buildApp({ fs, getPayment });
    const body = { type: 'payment', data: { id: 'pay_replay' } };

    const r1 = await request(app)
      .post('/api/billing/webhook/mercadopago')
      .set('x-signature', signBody(body))
      .send(body);
    expect(r1.status).toBe(200);
    expect(r1.body.outcome).toBe('paid');

    const r2 = await request(app)
      .post('/api/billing/webhook/mercadopago')
      .set('x-signature', signBody(body))
      .send(body);
    expect(r2.status).toBe(200);
    expect(r2.body.outcome).toBe('paid');

    // Critical: getPayment was only called ONCE.
    expect(getPayment).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the MP API call fails', async () => {
    const getPayment = vi.fn(async () => {
      throw new Error('MP 503 service unavailable');
    });

    const app = buildApp({ fs, getPayment });
    const body = { type: 'payment', data: { id: 'pay_fail' } };
    const res = await request(app)
      .post('/api/billing/webhook/mercadopago')
      .set('x-signature', signBody(body))
      .send(body);

    expect(res.status).toBe(500);
  });

  it('ACKs 200 for non-payment notification types without calling MP', async () => {
    const getPayment = vi.fn();
    const app = buildApp({ fs, getPayment });
    const body = { type: 'merchant_order', data: { id: 'mo_1' } };
    const res = await request(app)
      .post('/api/billing/webhook/mercadopago')
      .set('x-signature', signBody(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('pending');
    expect(getPayment).not.toHaveBeenCalled();
  });
});
