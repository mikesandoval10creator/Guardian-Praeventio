// Tests for the server-side subscription tier gate (directive #11).
//
// The middleware reads users/{uid}.subscription.planId via the Admin SDK and
// compares against the canonical PLAN_RANK. Mounted after a (stubbed) auth
// layer on a throwaway route so we can assert each outcome.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));

import { requireTier } from '../../server/middleware/requireTier.js';
import { logger } from '../../utils/logger.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// Stub "verifyAuth": x-test-uid header → req.user.uid; absent → 401.
function authStub(req: Request, res: Response, next: NextFunction) {
  const uid = req.header('x-test-uid');
  if (!uid) return void res.status(401).json({ error: 'unauthorized' });
  (req as Request & { user: { uid: string } }).user = { uid };
  next();
}

function buildApp(minPlan: Parameters<typeof requireTier>[0]) {
  const app = express();
  app.get('/gated', authStub, requireTier(minPlan), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

const seedSubscription = (uid: string, subscription: Record<string, unknown>) =>
  H.db!._seed(`users/${uid}`, { subscription });

const seedPlan = (uid: string, planId: unknown) =>
  H.db!._seed(
    `users/${uid}`,
    planId === undefined
      ? {}
      : { subscription: { planId, status: 'active', paymentMethod: 'webpay' } },
  );

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('requireTier', () => {
  it('401 when there is no authenticated caller', async () => {
    const res = await request(buildApp('oro')).get('/gated');
    expect(res.status).toBe(401);
  });

  it('200 when the caller plan ranks at or above the minimum', async () => {
    seedPlan('u1', 'titanio'); // rank 5 ≥ oro (4)
    const res = await request(buildApp('oro')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 at the exact minimum plan', async () => {
    seedPlan('u1', 'oro');
    const res = await request(buildApp('oro')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
  });

  it('402 upgrade_required when the caller plan ranks below the minimum', async () => {
    seedPlan('u1', 'plata'); // rank 3 < titanio (5)
    const res = await request(buildApp('titanio')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('upgrade_required');
    expect(res.body.requiredPlan).toBe('titanio');
    expect(res.body.currentPlan).toBe('plata');
  });

  it('402 (free) when the user doc has no plan at all', async () => {
    seedPlan('u1', undefined); // doc exists, no subscription
    const res = await request(buildApp('cobre')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(402);
    expect(res.body.currentPlan).toBe('free');
  });

  it.each(['expired', 'revoked'])('402 when a paid subscription is %s', async (status) => {
    seedSubscription('u1', { planId: 'diamante', status, paymentMethod: 'webpay' });
    const res = await request(buildApp('oro')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ error: 'upgrade_required', currentPlan: 'free' });
  });

  it('402 when an active subscription expiry is in the past', async () => {
    seedSubscription('u1', {
      planId: 'diamante',
      status: 'active',
      provider: 'app-store',
      expiryDate: '2020-01-01T00:00:00.000Z',
    });
    const res = await request(buildApp('oro')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(402);
    expect(res.body.currentPlan).toBe('free');
  });

  it('402 when a paid subscription has no lifecycle status or provider', async () => {
    seedSubscription('u1', { planId: 'diamante' });
    const res = await request(buildApp('oro')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(402);
    expect(res.body.currentPlan).toBe('free');
  });

  it('200 during an explicit unexpired grace period', async () => {
    seedSubscription('u1', {
      planId: 'oro',
      status: 'grace_period',
      provider: 'app-store',
      gracePeriodEnd: '2999-01-01T00:00:00.000Z',
    });
    const res = await request(buildApp('oro')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
  });

  it('honours a legacy plan alias (premium → oro, rank 3)', async () => {
    seedPlan('u1', 'premium'); // normalizes to oro (rank 3)
    const ok = await request(buildApp('cobre')).get('/gated').set('x-test-uid', 'u1'); // need ≥1
    expect(ok.status).toBe(200);
    const denied = await request(buildApp('titanio')).get('/gated').set('x-test-uid', 'u1'); // need ≥4
    expect(denied.status).toBe(402);
  });

  it('fails CLOSED with 403 when the plan lookup throws', async () => {
    seedPlan('u1', 'corporativo'); // would normally pass…
    H.db!._failReads('users/'); // …but the read blows up
    const res = await request(buildApp('oro')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tier_check_failed');
  });
});

// Report-only is the safe rollout phase 1 (TIER-GATING-SERVER-SIDE-SPEC.md §4):
// the gate NEVER blocks — it logs `tier_gate_would_block` so the route→tier
// table can be validated against real traffic before flipping enforce on.
function buildAppRO(minPlan: Parameters<typeof requireTier>[0]) {
  const app = express();
  app.get(
    '/gated',
    authStub,
    requireTier(minPlan, { enforce: false, route: 'test' }),
    (_req, res) => res.json({ ok: true }),
  );
  return app;
}
function buildAppNoAuthRO(minPlan: Parameters<typeof requireTier>[0]) {
  const app = express();
  // No auth layer → req.user undefined → report-only must DEFER (next), never 401.
  app.get('/gated', requireTier(minPlan, { enforce: false }), (_req, res) =>
    res.json({ ok: true }),
  );
  return app;
}

describe('requireTier report-only (enforce: false)', () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear());

  it('serves a below-minimum caller (200) and logs tier_gate_would_block', async () => {
    seedPlan('u1', 'plata'); // rank 2 < titanio (5)
    const res = await request(buildAppRO('titanio')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'tier_gate_would_block',
      expect.objectContaining({ requiredPlan: 'titanio', currentPlan: 'plata' }),
    );
  });

  it.each(['expired', 'revoked'])(
    'still blocks an explicitly %s paid entitlement because report-only covers tier rollout, not billing lifecycle',
    async (status) => {
      seedSubscription('u1', { planId: 'diamante', status, paymentMethod: 'webpay' });
      const res = await request(buildAppRO('titanio')).get('/gated').set('x-test-uid', 'u1');
      expect(res.status).toBe(402);
      expect(res.body.currentPlan).toBe('free');
    },
  );

  it('serves through when the plan lookup throws (no fail-closed in report-only)', async () => {
    seedPlan('u1', 'plata');
    H.db!._failReads('users/');
    const res = await request(buildAppRO('titanio')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
  });

  it('defers (200) instead of 401 when there is no authenticated caller', async () => {
    const res = await request(buildAppNoAuthRO('titanio')).get('/gated');
    expect(res.status).toBe(200);
  });

  it('still serves a sufficient plan without a would-block log', async () => {
    seedPlan('u1', 'platino'); // rank 6 ≥ titanio (5)
    const res = await request(buildAppRO('titanio')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith('tier_gate_would_block', expect.anything());
  });
});
