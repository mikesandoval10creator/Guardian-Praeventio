// Real-router supertest for the lone-worker safety surface.
// Covers all 5 endpoints: check-in, end-session, derive-status,
// decide-escalation, admin-overview.
//
// The service functions (recordCheckIn / endSession / deriveLoneWorkerStatus /
// decideEscalation) are pure compute — they run real here so v8 counts them.
// check-in/derive touch only the membership document; end-session additionally
// reads and updates the persisted canonical session through Admin SDK.
// idempotencyKey middleware is present on check-in + end-session but optional
// (header-driven); tests omit the header so the middleware is a no-op pass-through
// (avoiding the need to mock system_idempotency_cache).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── hoisted holder so db can be (re)assigned in beforeEach ──────────────────
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
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    const role = req.header('x-test-role');
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      ...(role ? { role } : {}),
      ...(req.header('x-test-admin') === 'true' ? { admin: true } : {}),
    };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: (...a: unknown[]) => H.audit(...a),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// observability — pulled in by idempotencyKey via getErrorTracker
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import loneWorkerRouter from '../../server/routes/loneWorker.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { captureRouteError } from '../../server/middleware/captureRouteError.js';

// ── app factory ─────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', loneWorkerRouter);
  return app;
}

// ── test data helpers ────────────────────────────────────────────────────────
const NOW_ISO = '2026-05-31T12:00:00.000Z';
const STARTED_ISO = '2026-05-31T08:00:00.000Z'; // 4 h ago

/** A minimal valid active session with no check-ins (active — within interval). */
function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sess-001',
    workerUid: 'worker-uid',
    startedAt: NOW_ISO, // just started — will be "active" relative to now
    checkInIntervalMin: 30,
    checkIns: [],
    status: 'active',
    ...overrides,
  };
}

/** Seed the fake Firestore so assertProjectMember passes for (uid, projectId). */
function seedMember(uid: string, projectId: string) {
  H.db!._seed(`projects/${projectId}`, { members: [uid], createdBy: uid });
}

function seedPersistedSession(
  overrides: Record<string, unknown> = {},
): void {
  H.db!._seed('projects/proj-1/lone_worker_sessions/sess-001', {
    ...makeSession({ workerUid: 'worker-uid' }),
    nativeManDownCapabilityHash: 'hash',
    nativeManDownCapabilityExpiresAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  });
}

// Reset mock call history before every test so a future assertion on H.audit
// call counts can't get a false positive from a sibling test (review finding,
// mirroring subscription.router.test.ts).
beforeEach(() => {
  H.audit.mockClear();
  vi.mocked(captureRouteError).mockClear();
});

// ── 401 helpers ─────────────────────────────────────────────────────────────
describe('all lone-worker endpoints → 401 without auth token', () => {
  beforeEach(() => { H.db = createFakeFirestore(); });

  const endpoints = [
    '/api/p1/lone-worker/check-in',
    '/api/p1/lone-worker/end-session',
    '/api/p1/lone-worker/derive-status',
    '/api/p1/lone-worker/decide-escalation',
    '/api/p1/lone-worker/admin-overview',
  ];

  for (const path of endpoints) {
    it(`POST ${path} → 401`, async () => {
      const res = await request(buildApp()).post(path).send({});
      expect(res.status).toBe(401);
    });
  }
});

// ── POST /:projectId/lone-worker/check-in ────────────────────────────────────
describe('POST /:projectId/lone-worker/check-in', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedMember('worker-uid', 'proj-1');
  });

  it('200 happy path: worker checks in for themselves → session has new checkIn entry', async () => {
    const session = makeSession({ workerUid: 'worker-uid', startedAt: STARTED_ISO });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/check-in')
      .set('x-test-uid', 'worker-uid')
      .send({
        session,
        checkIn: { at: NOW_ISO, lat: -33.4, lng: -70.6, status: 'ok' },
      });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.session).toBeDefined();
    const returned = body.session as Record<string, unknown>;
    const checkIns = returned.checkIns as Array<Record<string, unknown>>;
    expect(checkIns).toHaveLength(1);
    expect(checkIns[0].status).toBe('ok');
    expect(checkIns[0].lat).toBe(-33.4);
    expect(returned.status).toBe('active');
  });

  it('200 help check-in → session.status becomes help_requested', async () => {
    const session = makeSession({ workerUid: 'worker-uid', startedAt: STARTED_ISO });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/check-in')
      .set('x-test-uid', 'worker-uid')
      .send({
        session,
        checkIn: { at: NOW_ISO, status: 'help' },
      });
    expect(res.status).toBe(200);
    const returned = (res.body as Record<string, unknown>).session as Record<string, unknown>;
    expect(returned.status).toBe('help_requested');
  });

  it('LIFE-SAFETY (CLAUDE.md #14): a help check-in must still return 200 when the audit log is down', async () => {
    // recordCheckIn already succeeded; an audit-log outage must NOT turn a
    // worker distress signal into a 500 (they would think help was not received).
    H.audit.mockRejectedValueOnce(new Error('audit backend down'));
    const session = makeSession({ workerUid: 'worker-uid', startedAt: STARTED_ISO });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/check-in')
      .set('x-test-uid', 'worker-uid')
      .send({ session, checkIn: { at: NOW_ISO, status: 'help' } });
    expect(res.status).toBe(200);
    const returned = (res.body as Record<string, unknown>).session as Record<string, unknown>;
    expect(returned.status).toBe('help_requested');
    // The audit failure is still captured (not silently dropped).
    expect(captureRouteError).toHaveBeenCalledWith(
      expect.any(Error),
      'loneWorker.checkIn.audit',
      expect.objectContaining({ projectId: 'proj-1' }),
    );
  });

  it('400 missing required session field (no id)', async () => {
    const { id: _id, ...noId } = makeSession({ workerUid: 'worker-uid' }) as Record<string, unknown>;
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/check-in')
      .set('x-test-uid', 'worker-uid')
      .send({ session: noId, checkIn: { status: 'ok' } });
    expect(res.status).toBe(400);
  });

  it('400 checkIn.status invalid enum value', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/check-in')
      .set('x-test-uid', 'worker-uid')
      .send({
        session: makeSession({ workerUid: 'worker-uid' }),
        checkIn: { status: 'maybe' },
      });
    expect(res.status).toBe(400);
  });

  it('403 worker trying to check-in for a different workerUid (anti-impersonation)', async () => {
    seedMember('caller-uid', 'proj-1');
    const session = makeSession({ workerUid: 'different-worker' });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/check-in')
      .set('x-test-uid', 'caller-uid')
      .send({ session, checkIn: { status: 'ok' } });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('403 caller not a member of the project', async () => {
    // proj-1 only has worker-uid; outsider is not seeded
    const session = makeSession({ workerUid: 'outsider' });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/check-in')
      .set('x-test-uid', 'outsider')
      .send({ session, checkIn: { status: 'ok' } });
    expect(res.status).toBe(403);
  });
});

// ── POST /:projectId/lone-worker/end-session ─────────────────────────────────
describe('POST /:projectId/lone-worker/end-session', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    H.db!._seed('projects/proj-1', {
      members: ['supervisor-uid', 'worker-uid', 'member-uid', 'rescue-uid'],
      createdBy: 'supervisor-uid',
    });
    seedPersistedSession();
  });

  it('200 worker closes their own persisted session and revokes capability', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'worker-uid')
      .send({ sessionId: 'sess-001' });
    expect(res.status).toBe(200);
    expect(res.body.session).toMatchObject({
      id: 'sess-001',
      workerUid: 'worker-uid',
      status: 'ended',
    });
    expect(typeof res.body.session.endedAt).toBe('string');
    const persisted = H.db!._dump()['projects/proj-1/lone_worker_sessions/sess-001'];
    expect(persisted.status).toBe('ended');
    expect(persisted.endedBy).toBe('worker-uid');
    expect(persisted.nativeManDownCapabilityHash).toBeUndefined();
    expect(persisted.nativeManDownCapabilityExpiresAt).toBeUndefined();
  });

  it('200 supervisor closes another worker session using the verified rescue role', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'supervisor-uid')
      .set('x-test-role', 'supervisor')
      .send({ sessionId: 'sess-001', endedAt: '2099-01-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('ended');
    expect(res.body.session.endedAt).not.toBe('2099-01-01T00:00:00.000Z');
  });

  for (const role of [
    'admin',
    'gerente',
    'prevencionista',
    'director_obra',
    'medico_ocupacional',
  ]) {
    it(`200 ${role} closes another worker session`, async () => {
      const res = await request(buildApp())
        .post('/api/proj-1/lone-worker/end-session')
        .set('x-test-uid', 'rescue-uid')
        .set('x-test-role', role)
        .send({ sessionId: 'sess-001' });
      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe('ended');
    });
  }

  it('403 project member without rescue role cannot close another worker persisted session', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'member-uid')
      .send({ sessionId: 'sess-001' });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe(
      'forbidden_not_session_owner_or_rescuer',
    );
    expect(H.db!._dump()['projects/proj-1/lone_worker_sessions/sess-001'].status).toBe(
      'active',
    );
  });

  it('403 non-member caller', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'outsider')
      .send({ sessionId: 'sess-001' });
    expect(res.status).toBe(403);
  });

  it('403 platform_operator is not a project rescue role', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'rescue-uid')
      .set('x-test-role', 'platform_operator')
      .send({ sessionId: 'sess-001' });
    expect(res.status).toBe(403);
    expect(H.db!._dump()['projects/proj-1/lone_worker_sessions/sess-001'].status).toBe(
      'active',
    );
  });

  it('404 missing persisted session', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'worker-uid')
      .send({ sessionId: 'missing-session' });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('session_not_found');
  });

  it('400 strict schema rejects the legacy full-session payload', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'worker-uid')
      .send({ sessionId: 'sess-001', session: makeSession() });
    expect(res.status).toBe(400);
  });

  it('200 replay returns the persisted ended session without changing endedAt', async () => {
    const first = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'worker-uid')
      .send({ sessionId: 'sess-001' });
    const second = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'worker-uid')
      .send({ sessionId: 'sess-001' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.session).toEqual(first.body.session);
    expect(H.audit.mock.calls[0][3]).toMatchObject({ wasReplay: false });
    expect(H.audit.mock.calls[1][3]).toMatchObject({ wasReplay: true });
  });

  it('400 invalid endedAt is rejected even though the server owns the timestamp', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/end-session')
      .set('x-test-uid', 'worker-uid')
      .send({ sessionId: 'sess-001', endedAt: 'not-a-date' });
    expect(res.status).toBe(400);
  });
});

// ── POST /:projectId/lone-worker/derive-status ───────────────────────────────
describe('POST /:projectId/lone-worker/derive-status', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedMember('caller-uid', 'proj-1');
  });

  it('200 active session → status active', async () => {
    const session = makeSession({ workerUid: 'worker-uid', startedAt: NOW_ISO });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/derive-status')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('active');
  });

  it('200 overdue_warning: > 1× interval since last check-in', async () => {
    // Interval = 30 min; last event was 45 min ago
    const fortyFiveMinAgo = new Date(Date.parse(NOW_ISO) - 45 * 60_000).toISOString();
    const session = makeSession({
      workerUid: 'worker-uid',
      startedAt: fortyFiveMinAgo,
      checkInIntervalMin: 30,
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/derive-status')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('overdue_warning');
  });

  it('200 overdue_critical: > 2× interval since last check-in', async () => {
    // Interval = 30 min; last event was 70 min ago (> 60)
    const seventyMinAgo = new Date(Date.parse(NOW_ISO) - 70 * 60_000).toISOString();
    const session = makeSession({
      workerUid: 'worker-uid',
      startedAt: seventyMinAgo,
      checkInIntervalMin: 30,
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/derive-status')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('overdue_critical');
  });

  it('200 help_requested when a checkIn with status=help exists', async () => {
    const session = makeSession({
      workerUid: 'worker-uid',
      startedAt: STARTED_ISO,
      checkIns: [{ at: NOW_ISO, status: 'help' }],
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/derive-status')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('help_requested');
  });

  it('200 ended session → status ended', async () => {
    const session = makeSession({
      workerUid: 'worker-uid',
      startedAt: STARTED_ISO,
      endedAt: NOW_ISO,
      status: 'ended',
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/derive-status')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('ended');
  });

  it('400 missing session', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/derive-status')
      .set('x-test-uid', 'caller-uid')
      .send({});
    expect(res.status).toBe(400);
  });

  it('403 non-member caller', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/derive-status')
      .set('x-test-uid', 'outsider')
      .send({ session: makeSession() });
    expect(res.status).toBe(403);
  });
});

// ── POST /:projectId/lone-worker/decide-escalation ───────────────────────────
describe('POST /:projectId/lone-worker/decide-escalation', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedMember('caller-uid', 'proj-1');
  });

  it('200 active session → escalation is null (no action needed)', async () => {
    const session = makeSession({ workerUid: 'worker-uid', startedAt: NOW_ISO });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/decide-escalation')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).escalation).toBeNull();
  });

  it('200 overdue_warning → escalation level supervisor', async () => {
    const fortyFiveMinAgo = new Date(Date.parse(NOW_ISO) - 45 * 60_000).toISOString();
    const session = makeSession({
      workerUid: 'worker-uid',
      startedAt: fortyFiveMinAgo,
      checkInIntervalMin: 30,
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/decide-escalation')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    const escalation = (res.body as Record<string, unknown>).escalation as Record<string, unknown>;
    expect(escalation.level).toBe('supervisor');
    expect(typeof escalation.message).toBe('string');
    expect(typeof escalation.triggeredAt).toBe('string');
  });

  it('200 overdue_critical → escalation level brigade', async () => {
    const seventyMinAgo = new Date(Date.parse(NOW_ISO) - 70 * 60_000).toISOString();
    const session = makeSession({
      workerUid: 'worker-uid',
      startedAt: seventyMinAgo,
      checkInIntervalMin: 30,
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/decide-escalation')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    const escalation = (res.body as Record<string, unknown>).escalation as Record<string, unknown>;
    expect(escalation.level).toBe('brigade');
  });

  it('200 help_requested → escalation level emergency_services', async () => {
    const session = makeSession({
      workerUid: 'worker-uid',
      startedAt: STARTED_ISO,
      checkIns: [{ at: NOW_ISO, status: 'help' }],
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/decide-escalation')
      .set('x-test-uid', 'caller-uid')
      .send({ session, now: NOW_ISO });
    expect(res.status).toBe(200);
    const escalation = (res.body as Record<string, unknown>).escalation as Record<string, unknown>;
    expect(escalation.level).toBe('emergency_services');
    expect(escalation.message).toMatch(/solicitó ayuda/);
  });

  it('400 invalid now string', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/decide-escalation')
      .set('x-test-uid', 'caller-uid')
      .send({ session: makeSession(), now: 'x' }); // min(10) → fails
    expect(res.status).toBe(400);
  });

  it('403 non-member caller', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/decide-escalation')
      .set('x-test-uid', 'outsider')
      .send({ session: makeSession() });
    expect(res.status).toBe(403);
  });
});

// ── POST /:projectId/lone-worker/admin-overview ──────────────────────────────
describe('POST /:projectId/lone-worker/admin-overview', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedMember('admin-uid', 'proj-1');
  });

  it('200 empty sessions array → overview is []', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/admin-overview')
      .set('x-test-uid', 'admin-uid')
      .send({ sessions: [], now: NOW_ISO });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).overview).toEqual([]);
  });

  it('200 multiple sessions → each entry has session + status + escalation', async () => {
    const activeSession = makeSession({
      id: 's1',
      workerUid: 'w1',
      startedAt: NOW_ISO,
    });
    const helpSession = makeSession({
      id: 's2',
      workerUid: 'w2',
      startedAt: STARTED_ISO,
      checkIns: [{ at: NOW_ISO, status: 'help' }],
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/admin-overview')
      .set('x-test-uid', 'admin-uid')
      .send({ sessions: [activeSession, helpSession], now: NOW_ISO });
    expect(res.status).toBe(200);
    const overview = (res.body as Record<string, unknown>).overview as Array<Record<string, unknown>>;
    expect(overview).toHaveLength(2);

    const active = overview.find((e) => (e.session as Record<string, unknown>).id === 's1')!;
    expect(active.status).toBe('active');
    expect(active.escalation).toBeNull();

    const help = overview.find((e) => (e.session as Record<string, unknown>).id === 's2')!;
    expect(help.status).toBe('help_requested');
    expect((help.escalation as Record<string, unknown>).level).toBe('emergency_services');
  });

  it('200 overdue sessions show correct escalation levels in bulk', async () => {
    const warningSession = makeSession({
      id: 'sw',
      workerUid: 'ww',
      startedAt: new Date(Date.parse(NOW_ISO) - 45 * 60_000).toISOString(),
      checkInIntervalMin: 30,
    });
    const criticalSession = makeSession({
      id: 'sc',
      workerUid: 'wc',
      startedAt: new Date(Date.parse(NOW_ISO) - 70 * 60_000).toISOString(),
      checkInIntervalMin: 30,
    });
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/admin-overview')
      .set('x-test-uid', 'admin-uid')
      .send({ sessions: [warningSession, criticalSession], now: NOW_ISO });
    expect(res.status).toBe(200);
    const overview = (res.body as Record<string, unknown>).overview as Array<Record<string, unknown>>;
    const warning = overview.find((e) => (e.session as Record<string, unknown>).id === 'sw')!;
    expect(warning.status).toBe('overdue_warning');
    expect((warning.escalation as Record<string, unknown>).level).toBe('supervisor');

    const critical = overview.find((e) => (e.session as Record<string, unknown>).id === 'sc')!;
    expect(critical.status).toBe('overdue_critical');
    expect((critical.escalation as Record<string, unknown>).level).toBe('brigade');
  });

  it('400 sessions is not an array', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/admin-overview')
      .set('x-test-uid', 'admin-uid')
      .send({ sessions: 'not-an-array', now: NOW_ISO });
    expect(res.status).toBe(400);
  });

  it('400 sessions item missing required id field', async () => {
    const { id: _id, ...noId } = makeSession() as Record<string, unknown>;
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/admin-overview')
      .set('x-test-uid', 'admin-uid')
      .send({ sessions: [noId], now: NOW_ISO });
    expect(res.status).toBe(400);
  });

  it('403 non-member caller', async () => {
    const res = await request(buildApp())
      .post('/api/proj-1/lone-worker/admin-overview')
      .set('x-test-uid', 'outsider')
      .send({ sessions: [] });
    expect(res.status).toBe(403);
  });
});
