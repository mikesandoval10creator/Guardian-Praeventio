// Praeventio Guard — Fatigue Monitor router: real-router supertest (CLAUDE.md #22).
// Boots the REAL fatigue router with admin.firestore() backed by the in-memory
// FakeFirestore, runs the REAL assessFatigue engine + projectMembership guard,
// and asserts the assess endpoint over HTTP: 401 (no token), 403 (non-member),
// 400 (invalid body), and a deterministic happy-path 200 whose body reflects the
// real engine output (critical risk for >12h/24h per DS 594 art. 102).
//
// The router is PURE compute (no Firestore writes — directive #2: never blocks,
// only flags shouldRestrictCritical). So persistence assertions here cover the
// READ path the guard exercises (the seeded project doc gates membership), and
// the response body is asserted against the real engine's math, not a stub.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = { uid, email: req.header('x-test-email') ?? null } as import('express').Request['user'];
    next();
  },
}));

vi.mock('../middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import fatigueRouter from './fatigue';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PREFIX = '/api/sprint-i';
const PROJECT = 'p1';
const SUPERVISOR = 'supervisor-1';
const WORKER = 'worker-2';
const OUTSIDER = 'outsider-9';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, fatigueRouter);
  return app;
}

function seedProject(members: string[] = [SUPERVISOR, WORKER]) {
  H.db!._seed(`projects/${PROJECT}`, { members, createdBy: SUPERVISOR });
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const base = `${PREFIX}/${PROJECT}/fatigue/assess`;

// Deterministic clock so the engine math is exact.
const NOW = '2026-06-01T20:00:00.000Z';
// One 13h session ending at NOW → totalHoursLast24h = 13 > 12 (DS 594 art. 102)
// → engine returns risk 'critical' + shouldRestrictCritical true.
const CRITICAL_SESSION = {
  workerUid: WORKER,
  startedAt: '2026-06-01T07:00:00.000Z',
  endedAt: NOW,
  isNight: false,
  hadCriticalTasks: true,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

describe('POST /:projectId/fatigue/assess', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(base)
      .send({ workerUid: WORKER, sessions: [] });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(base)
      .set(asUser(OUTSIDER))
      .send({ workerUid: WORKER, sessions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on an invalid body (sessions missing required isNight/hadCriticalTasks)', async () => {
    const res = await request(buildApp())
      .post(base)
      .set(asUser(SUPERVISOR))
      .send({
        workerUid: WORKER,
        // session is malformed: lacks isNight + hadCriticalTasks booleans
        sessions: [{ workerUid: WORKER, startedAt: NOW }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when workerUid is missing entirely', async () => {
    const res = await request(buildApp())
      .post(base)
      .set(asUser(SUPERVISOR))
      .send({ sessions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns the REAL engine assessment for a member (low risk, no sessions)', async () => {
    const res = await request(buildApp())
      .post(base)
      .set(asUser(WORKER))
      .send({ workerUid: WORKER, sessions: [], now: NOW });
    expect(res.status).toBe(200);
    const a = res.body.assessment;
    expect(a).toBeTruthy();
    // Shape + identity stamped through from the real engine.
    expect(a.workerUid).toBe(WORKER);
    expect(a.assessedAt).toBe(NOW);
    // No sessions → no fatigue → low risk, never restricts critical work.
    expect(a.risk).toBe('low');
    expect(a.shouldRestrictCritical).toBe(false);
    expect(a.totalHoursLast24h).toBe(0);
    expect(Array.isArray(a.recommendations)).toBe(true);
    expect(a.recommendations).toHaveLength(0);
  });

  it('200 flags CRITICAL risk for a 13h shift in 24h (DS 594 art. 102), per directive #2 recommends but does not block', async () => {
    const res = await request(buildApp())
      .post(base)
      .set(asUser(SUPERVISOR))
      .send({ workerUid: WORKER, sessions: [CRITICAL_SESSION], now: NOW });
    expect(res.status).toBe(200);
    const a = res.body.assessment;
    expect(a.workerUid).toBe(WORKER);
    // 13h ending at NOW → over the 12h/24h legal ceiling → critical.
    expect(a.totalHoursLast24h).toBe(13);
    expect(a.risk).toBe('critical');
    expect(a.shouldRestrictCritical).toBe(true);
    // Real engine emits the DS 594 recommendation string, not a stub.
    expect(a.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(a.recommendations.some((r: string) => r.includes('DS 594'))).toBe(true);
  });

  it('member gate reads the seeded project doc: still 403 when the project is unseeded', async () => {
    // Fresh db with no project doc → assertProjectMember throws → 403, proving
    // the guard actually performs the Firestore read (not a no-op).
    H.db = createFakeFirestore();
    const res = await request(buildApp())
      .post(base)
      .set(asUser(SUPERVISOR))
      .send({ workerUid: WORKER, sessions: [], now: NOW });
    expect(res.status).toBe(403);
    // Sanity: the same caller passes once the doc exists.
    seedProject();
    const ok = await request(buildApp())
      .post(base)
      .set(asUser(SUPERVISOR))
      .send({ workerUid: WORKER, sessions: [], now: NOW });
    expect(ok.status).toBe(200);
  });
});
