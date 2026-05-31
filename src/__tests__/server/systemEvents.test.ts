// Real-router supertest for the SystemEngine emit endpoint
// (src/server/routes/systemEvents.ts) — the server-side bus write that stamps
// tenantId from the verified token so a worker on tenant A cannot inject events
// into tenant B. Mounts the ACTUAL router + real SystemEventSchema through the
// reusable fakeFirestore (the route had 0 tests).

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
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import systemEventsRouter from '../../server/routes/systemEvents.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/system-events', systemEventsRouter);
  return app;
}

const EMIT = '/api/system-events/emit';

// A valid SystemEvent envelope + fall_detected payload.
const event = {
  id: 'evt-1',
  tenantId: 't1',
  ts: 1_717_000_000_000,
  idempotencyKey: 'idem-evt-1',
  type: 'fall_detected' as const,
  payload: { workerId: 'w1', projectId: 'p1', confidence: 0.92, accelMagnitude: 25 },
};

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('POST /system-events/emit', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(EMIT).send({ event });
    expect(res.status).toBe(401);
  });

  it('403 when the caller has no tenant claim', async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1') // no x-test-tenant
      .send({ event });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('missing tenant claim');
  });

  it("403 when the event's tenantId differs from the caller's claim (no cross-tenant inject)", async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1')
      .set('x-test-tenant', 't2') // claim t2, event says t1
      .send({ event });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tenant mismatch');
  });

  it('200 emits + persists to the tenant bus when the claim matches', async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1')
      .set('x-test-tenant', 't1')
      .send({ event });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, eventId: 'evt-1' });
    // It wrote to the tenant-scoped bus, stamping the actor.
    const stored = (
      await H.db!.collection('tenants/t1/system_events').doc('evt-1').get()
    ).data() as Record<string, unknown>;
    expect(stored.type).toBe('fall_detected');
    expect(stored.actorUid).toBe('w1');
  });

  it('400 on an invalid event payload (schema)', async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1')
      .set('x-test-tenant', 't1')
      .send({ event: { ...event, payload: { workerId: 'w1' } } }); // missing required fields
    expect(res.status).toBe(400);
  });
});
