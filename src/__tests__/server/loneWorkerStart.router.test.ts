// Real-router supertest for src/server/routes/loneWorker.ts — /start-session.
//
// Behavioral coverage for the NEW audited session-START endpoint (the only
// lone-worker lifecycle action that was previously unaudited — built + written
// entirely client-side). Pins the hardened contract: workerUid + id are
// server-stamped (identity from the verified token, id server-minted, NEVER the
// body), and the start is written to audit_logs.
//
// Isolated in its own file (like stoppageResolve.router.test.ts): it exercises
// the audited path with a real Firestore-backed adapter, distinct from the
// stateless wire-up contract test in src/server/routes/loneWorker.test.ts.

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
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import loneWorkerRouter from '../../server/routes/loneWorker.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', loneWorkerRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const PROJECT = 'proj-alpha';
const MEMBER_UID = 'uid-member';
const OTHER_UID = 'uid-stranger';
const ENDPOINT = `/api/${PROJECT}/lone-worker/start-session`;

function seedProject(db: ReturnType<typeof createFakeFirestore>) {
  db._seed(`projects/${PROJECT}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
}

function auditStartRows() {
  return Object.entries(H.db!._dump())
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v as Record<string, unknown>)
    .filter((r) => r.action === 'loneWorker.startSession');
}

const validBody = {
  checkInIntervalMin: 15,
  startedAt: '2026-06-14T11:00:00Z',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

describe('POST /:projectId/lone-worker/start-session', () => {
  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member caller', async () => {
    const res = await request(buildApp()).post(ENDPOINT).set(asUser(OTHER_UID)).send(validBody);
    expect(res.status).toBe(403);
    expect(auditStartRows().length).toBe(0);
  });

  it('400 for invalid body — missing checkInIntervalMin', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ startedAt: '2026-06-14T11:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('400 for out-of-range checkInIntervalMin', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ checkInIntervalMin: 0 });
    expect(res.status).toBe(400);
  });

  it('200 happy path — fresh active session, workerUid+id server-stamped, audited', async () => {
    const res = await request(buildApp()).post(ENDPOINT).set(asUser(MEMBER_UID)).send(validBody);
    expect(res.status).toBe(200);
    const s = (res.body as { session: Record<string, unknown> }).session;
    expect(s.workerUid).toBe(MEMBER_UID); // from the token
    expect(typeof s.id).toBe('string');
    expect((s.id as string).length).toBeGreaterThan(0); // server-minted, no client RNG
    expect(s.status).toBe('active');
    expect(s.checkIns).toEqual([]);
    expect(s.endedAt).toBeUndefined();
    expect(s.checkInIntervalMin).toBe(15);

    // Audit trail with the server-stamped actor (CLAUDE.md #3).
    const rows = auditStartRows();
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(MEMBER_UID);
    expect(rows[0].projectId).toBe(PROJECT);
    expect((rows[0].details as Record<string, unknown>).workerUid).toBe(MEMBER_UID);
  });

  it('ignores a client-supplied workerUid in the body — the token uid wins', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      // Attacker tries to start a monitored session attributed to someone else.
      .send({ ...validBody, workerUid: OTHER_UID, id: 'attacker-chosen-id' });
    expect(res.status).toBe(200);
    const s = (res.body as { session: Record<string, unknown> }).session;
    expect(s.workerUid).toBe(MEMBER_UID); // token, NOT body OTHER_UID
    expect(s.id).not.toBe('attacker-chosen-id'); // server-minted, not body
    expect((auditStartRows()[0].details as Record<string, unknown>).workerUid).toBe(MEMBER_UID);
  });

  it('carries optional lastKnownLocation through to the session', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({
        ...validBody,
        lastKnownLocation: { lat: -33.45, lng: -70.66, at: '2026-06-14T11:00:00Z' },
      });
    expect(res.status).toBe(200);
    const s = (res.body as { session: Record<string, any> }).session;
    expect(s.lastKnownLocation).toMatchObject({ lat: -33.45, lng: -70.66 });
  });
});
