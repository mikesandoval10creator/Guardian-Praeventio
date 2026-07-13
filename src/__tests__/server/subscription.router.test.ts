// Real-router companion to subscription.test.ts (which drives the test-server.ts
// MIRROR). This file mounts the ACTUAL router (src/server/routes/subscription.ts)
// through the reusable fakeFirestore, so it is genuine coverage of the
// production handler — catching any drift between the mirror and the real code,
// and additionally asserting the awaited audit-log call (CLAUDE.md rule #14).
//
// POST /api/subscription/upgrade is the anti-privilege-escalation gate
// (Round 22 CRITICAL #1): before it, any authed user could self-assign the
// ~$5M CLP/mes "ilimitado" plan via the client SDK. The gate upgrades ONLY if
// the caller owns a `status: paid` invoice whose tierId matches the requested
// plan. Load-bearing test: cross-plan escalation must 403.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  audit: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: (...a: unknown[]) => H.audit(...a),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import subscriptionRouter from '../../server/routes/subscription.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { captureRouteError } from '../../server/middleware/captureRouteError.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/subscription', subscriptionRouter);
  return app;
}

const URL = '/api/subscription/upgrade';

function seedInvoice(id: string, fields: Record<string, unknown>) {
  H.db!._seed(`invoices/${id}`, fields);
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.audit.mockClear();
  vi.mocked(captureRouteError).mockClear();
});

describe('POST /api/subscription/upgrade (real router — privilege-escalation gate)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send({ planId: 'oro' });
    expect(res.status).toBe(401);
  });

  it('400 for an unknown plan id', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'ilimitado_hacker' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_plan');
  });

  it('403 when the caller has NO paid invoice at all', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'oro' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_paid_invoice_for_plan');
  });

  it('403 SECURITY: paid for "plata" cannot upgrade to "oro" (cross-plan escalation blocked)', async () => {
    seedInvoice('inv1', { createdBy: 'u1', status: 'paid', lineItems: [{ tierId: 'plata' }] });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'oro' });
    expect(res.status).toBe(403);
    // the user doc must NOT have been upgraded
    const user = (await H.db!.collection('users').doc('u1').get()).data();
    expect(user).toBeFalsy();
    expect(H.audit).not.toHaveBeenCalled();
  });

  it('403 when the matching invoice is NOT paid (status filter)', async () => {
    seedInvoice('inv1', { createdBy: 'u1', status: 'pending', lineItems: [{ tierId: 'oro' }] });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'oro' });
    expect(res.status).toBe(403);
  });

  it('403 when the paid invoice belongs to ANOTHER user', async () => {
    seedInvoice('inv1', { createdBy: 'someone-else', status: 'paid', lineItems: [{ tierId: 'oro' }] });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'oro' });
    expect(res.status).toBe(403);
  });

  it('409 when a matching paid invoice has no verifiable payment provider', async () => {
    seedInvoice('inv1', {
      createdBy: 'u1',
      status: 'paid',
      lineItems: [{ tierId: 'oro' }],
    });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'oro' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('unverifiable_payment_provider');
  });

  it('200 upgrades on a matching paid invoice (lineItems) + writes user doc + awaits audit', async () => {
    H.db!._seed('users/u1', {
      subscription: {
        planId: 'plata',
        status: 'expired',
        provider: 'app-store',
        expiryDate: '2020-01-01T00:00:00.000Z',
        gracePeriodEnd: '2020-01-02T00:00:00.000Z',
      },
    });
    seedInvoice('inv1', {
      createdBy: 'u1',
      status: 'paid',
      paymentMethod: 'webpay',
      lineItems: [{ tierId: 'oro' }],
    });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'oro' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const user = (await H.db!.collection('users').doc('u1').get()).data() as Record<string, any>;
    expect(user.subscription.planId).toBe('oro');
    expect(user.subscription.status).toBe('active');
    expect(user.subscription.paymentMethod).toBe('webpay');
    expect(user.subscription.provider).toBe('webpay');
    expect(user.subscription.expiryDate).toBeNull();
    expect(user.subscription.gracePeriodEnd).toBeNull();
    expect(H.audit).toHaveBeenCalledTimes(1);
  });

  it('200 (non-blocking): a post-upgrade audit failure must NOT 500 the already-applied upgrade (CLAUDE.md #14)', async () => {
    seedInvoice('inv1', {
      createdBy: 'u1',
      status: 'paid',
      paymentMethod: 'webpay',
      lineItems: [{ tierId: 'oro' }],
    });
    // The plan write at the top of the handler already succeeded; the audit
    // call comes AFTER it. If the audit backend is down, the user must still
    // see success (they paid + the plan was applied) — else they think the
    // payment failed and retry / contact support. Audit failure is captured,
    // not surfaced as a 500.
    H.audit.mockRejectedValueOnce(new Error('audit backend down'));
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'oro' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const user = (await H.db!.collection('users').doc('u1').get()).data() as Record<string, any>;
    expect(user.subscription.planId).toBe('oro');
    expect(user.subscription.status).toBe('active');
    // The audit failure must still be captured to Sentry (not silently dropped).
    expect(captureRouteError).toHaveBeenCalledWith(
      expect.any(Error),
      'subscription.upgraded.audit',
      expect.objectContaining({ uid: 'u1' }),
    );
  });

  it('200 also accepts the legacy top-level tierId schema', async () => {
    seedInvoice('inv2', {
      createdBy: 'u1',
      status: 'paid',
      paymentMethod: 'manual-transfer',
      tierId: 'titanio',
    });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ planId: 'titanio' });
    expect(res.status).toBe(200);
    const user = (await H.db!.collection('users').doc('u1').get()).data() as Record<string, any>;
    expect(user.subscription.planId).toBe('titanio');
    expect(user.subscription.paymentMethod).toBe('manual');
    expect(user.subscription.provider).toBe('manual');
  });
});
