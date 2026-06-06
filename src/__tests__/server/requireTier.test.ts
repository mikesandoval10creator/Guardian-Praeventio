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

const seedPlan = (uid: string, planId: unknown) =>
  H.db!._seed(`users/${uid}`, planId === undefined ? {} : { subscription: { planId } });

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
    const res = await request(buildApp('comite')).get('/gated').set('x-test-uid', 'u1');
    expect(res.status).toBe(402);
    expect(res.body.currentPlan).toBe('free');
  });

  it('honours a legacy plan alias (premium → departamento, rank 2)', async () => {
    seedPlan('u1', 'premium'); // normalizes to departamento (rank 2)
    const ok = await request(buildApp('comite')).get('/gated').set('x-test-uid', 'u1'); // need ≥1
    expect(ok.status).toBe(200);
    const denied = await request(buildApp('oro')).get('/gated').set('x-test-uid', 'u1'); // need ≥4
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
