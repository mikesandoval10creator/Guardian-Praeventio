// Real-router supertest for the SystemEngine emit endpoint
// (src/server/routes/systemEvents.ts) — the server-side bus write.
//
// A4 re-scope (2026-06): the bus moved from `tenants/{tid}/system_events`
// (doubly dead: no tenant claim was ever minted AND firestore.rules
// default-denied the path) to `projects/{pid}/system_events` — the app's
// real tenancy unit. The endpoint now authorizes via REAL
// assertProjectMember() against the projects collection (no tenant claim
// needed) and stamps actorUid from the verified token so a caller cannot
// emit as someone else. Mounts the ACTUAL router + real SystemEventSchema
// + real membership check through the reusable fakeFirestore.

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
    (req as Request & { user: Record<string, unknown> }).user = { uid };
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

// A valid SystemEvent envelope + fall_detected payload, project-scoped.
const event = {
  id: 'evt-1',
  tenantId: 'default',
  projectId: 'p1',
  ts: 1_717_000_000_000,
  idempotencyKey: 'idem-evt-1',
  type: 'fall_detected' as const,
  payload: { workerId: 'w1', projectId: 'p1', confidence: 0.92, accelMagnitude: 25 },
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // w1 is a member of p1; w-outsider is not.
  H.db._seed('projects/p1', {
    name: 'Faena Norte',
    members: ['w1'],
    createdBy: 'creator-1',
    status: 'active',
  });
});

describe('POST /system-events/emit', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(EMIT).send({ event });
    expect(res.status).toBe(401);
  });

  it('400 when the event has no envelope projectId (the bus is project-scoped)', async () => {
    const { projectId: _omit, ...withoutProject } = event;
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1')
      .send({ event: withoutProject });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing projectId');
  });

  it("403 when the caller is not a member of the event's project (no cross-project inject)", async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w-outsider')
      .send({ event });
    expect(res.status).toBe(403);
  });

  it('403 when the projectId does not exist (default-deny on unknown projects)', async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1')
      .send({
        event: {
          ...event,
          projectId: 'p-ghost',
          payload: { ...event.payload, projectId: 'p-ghost' },
        },
      });
    expect(res.status).toBe(403);
  });

  it('200 emits + persists to the project bus when the caller is a member', async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1')
      .send({ event });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, eventId: 'evt-1' });
    // It wrote to the PROJECT-scoped bus, stamping the actor from the token.
    const stored = (
      await H.db!.collection('projects/p1/system_events').doc('evt-1').get()
    ).data() as Record<string, unknown>;
    expect(stored.type).toBe('fall_detected');
    expect(stored.actorUid).toBe('w1');
    expect(stored.projectId).toBe('p1');
    // Nothing landed on the legacy dead path.
    const legacy = await H.db!
      .collection('tenants/default/system_events')
      .doc('evt-1')
      .get();
    expect(legacy.exists).toBe(false);
  });

  it('cannot spoof actorUid: the server overwrites any client-supplied value', async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1')
      .send({ event: { ...event, id: 'evt-2', idempotencyKey: 'idem-evt-2', actorUid: 'victim-uid' } });
    expect(res.status).toBe(200);
    const stored = (
      await H.db!.collection('projects/p1/system_events').doc('evt-2').get()
    ).data() as Record<string, unknown>;
    expect(stored.actorUid).toBe('w1');
  });

  it('400 on an invalid event payload (schema)', async () => {
    const res = await request(buildApp())
      .post(EMIT)
      .set('x-test-uid', 'w1')
      .send({ event: { ...event, payload: { workerId: 'w1' } } }); // missing required fields
    expect(res.status).toBe(400);
  });
});
