// Praeventio Guard — evacuation router: real-router behavioral supertest (CLAUDE.md
// #22). Boots the REAL evacuation router with admin.firestore() backed by the
// in-memory FakeFirestore, runs the REAL evacuationHeadcount engine
// (computeStatus / recordScan / endDrill / buildPostmortem), and asserts the
// full HTTP lifecycle of all four endpoints:
//
//   POST /:projectId/evacuation/compute-status
//   POST /:projectId/evacuation/record-scan
//   POST /:projectId/evacuation/end-drill
//   POST /:projectId/evacuation/build-postmortem
//
// This is a LIFE-CRITICAL surface (headcount during a real evacuation): the
// assertions are grounded in the engine's actual output, not just status codes.
// Notably we assert the server forces `scannedByUid` to the authenticated caller
// on record-scan so a client cannot ghost-scan for another worker.
//
// The router is PURE compute — it does NOT persist to Firestore. The only
// Firestore I/O is `assertProjectMember` reading the seeded project doc, so the
// genuine state assertions are on the engine output, plus the auth (401),
// membership (403) and validation (400 invalid_payload) gates.

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

import evacuationRouter from './evacuation';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PREFIX = '/api/sprint-g';
const PROJECT = 'p1';
const LEADER = 'leader-1';
const WORKER = 'worker-2';
const OUTSIDER = 'outsider-9';

const START = '2026-06-17T10:00:00.000Z';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, evacuationRouter);
  return app;
}

function seedProject(members: string[] = [LEADER, WORKER]) {
  H.db!._seed(`projects/${PROJECT}`, { members, createdBy: LEADER });
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const base = `${PREFIX}/${PROJECT}/evacuation`;

// A valid drill matching `drillSchema` in the router: two expected workers,
// one of whom (WORKER) has already scanned in → one safe, one missing.
function makeDrill(overrides: Partial<{ scans: unknown[]; endedAt: string }> = {}) {
  return {
    id: 'drill-1',
    projectId: PROJECT,
    kind: 'real' as const,
    startedAt: START,
    startedByUid: LEADER,
    meetingPointId: 'mp-1',
    expectedWorkers: [
      { uid: WORKER, fullName: 'Worker Two', lastKnownLocation: { lat: -33.45, lng: -70.66, at: START } },
      { uid: 'worker-3', fullName: 'Worker Three' },
    ],
    scans: overrides.scans ?? [
      { workerUid: WORKER, scannedAt: '2026-06-17T10:01:00.000Z', meetingPointId: 'mp-1', scannedByUid: WORKER },
    ],
    ...(overrides.endedAt ? { endedAt: overrides.endedAt } : {}),
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

describe('POST /:projectId/evacuation/compute-status', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${base}/compute-status`)
      .send({ drill: makeDrill() });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp())
      .post(`${base}/compute-status`)
      .set(asUser(OUTSIDER))
      .send({ drill: makeDrill() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on an invalid body (missing required drill fields)', async () => {
    const res = await request(buildApp())
      .post(`${base}/compute-status`)
      .set(asUser(LEADER))
      // `kind`, `meetingPointId`, etc. missing → fails drillSchema.
      .send({ drill: { id: 'd', projectId: PROJECT } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('200 computes the real headcount status for a member', async () => {
    // Pin `now` so elapsedSec is deterministic: 5 minutes after startedAt.
    const now = '2026-06-17T10:05:00.000Z';
    const res = await request(buildApp())
      .post(`${base}/compute-status`)
      .set(asUser(WORKER))
      .send({ drill: makeDrill(), now });
    expect(res.status).toBe(200);

    const { status } = res.body;
    // One expected worker scanned (WORKER) → safe; worker-3 → missing.
    expect(status.safe).toHaveLength(1);
    expect(status.safe[0]).toMatchObject({ uid: WORKER, fullName: 'Worker Two' });
    expect(status.missing).toHaveLength(1);
    expect(status.missing[0].uid).toBe('worker-3');
    // 1 of 2 expected accounted for → 50% coverage, not complete.
    expect(status.coveragePercent).toBe(50);
    expect(status.isComplete).toBe(false);
    // 5 minutes between startedAt and `now`.
    expect(status.elapsedSec).toBe(300);
  });
});

describe('POST /:projectId/evacuation/record-scan', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${base}/record-scan`)
      .send({ drill: makeDrill(), scan: { workerUid: 'worker-3', meetingPointId: 'mp-1' } });
    expect(res.status).toBe(401);
  });

  it('400 when the scan body is missing required fields', async () => {
    const res = await request(buildApp())
      .post(`${base}/record-scan`)
      .set(asUser(LEADER))
      // `scan.meetingPointId` missing → fails scanSchema.
      .send({ drill: makeDrill(), scan: { workerUid: 'worker-3' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 appends the scan and FORCES scannedByUid to the authenticated caller', async () => {
    // Start from a drill with NO scans so the new scan is appended.
    const drill = makeDrill({ scans: [] });
    const res = await request(buildApp())
      .post(`${base}/record-scan`)
      .set(asUser(LEADER)) // LEADER is the authenticated caller (a supervisor scanning for the worker)
      .send({ drill, scan: { workerUid: 'worker-3', meetingPointId: 'mp-1', scannedAt: '2026-06-17T10:02:00.000Z' } });

    expect(res.status).toBe(200);
    const returned = res.body.drill;
    expect(returned.scans).toHaveLength(1);
    const scan = returned.scans[0];
    expect(scan.workerUid).toBe('worker-3');
    expect(scan.meetingPointId).toBe('mp-1');
    expect(scan.scannedAt).toBe('2026-06-17T10:02:00.000Z');
    // Anti-ghost-scan: the server stamps scannedByUid from the token, NOT the
    // body — even though the body never supplied it, it must be the caller.
    expect(scan.scannedByUid).toBe(LEADER);
  });

  it('200 is idempotent — re-scanning an already-safe worker keeps the first scan', async () => {
    // WORKER already scanned at 10:01 in makeDrill(); a second scan must be a no-op
    // (the original timestamp is legally relevant per the engine contract).
    const res = await request(buildApp())
      .post(`${base}/record-scan`)
      .set(asUser(LEADER))
      .send({ drill: makeDrill(), scan: { workerUid: WORKER, meetingPointId: 'mp-1', scannedAt: '2026-06-17T10:09:00.000Z' } });

    expect(res.status).toBe(200);
    const returned = res.body.drill;
    // Still exactly one scan for WORKER, preserving the ORIGINAL 10:01 timestamp.
    const workerScans = returned.scans.filter((s: { workerUid: string }) => s.workerUid === WORKER);
    expect(workerScans).toHaveLength(1);
    expect(workerScans[0].scannedAt).toBe('2026-06-17T10:01:00.000Z');
  });
});

describe('POST /:projectId/evacuation/end-drill', () => {
  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .post(`${base}/end-drill`)
      .set(asUser(OUTSIDER))
      .send({ drill: makeDrill() });
    expect(res.status).toBe(403);
  });

  it('200 stamps endedAt on the drill', async () => {
    const endedAt = '2026-06-17T10:30:00.000Z';
    const res = await request(buildApp())
      .post(`${base}/end-drill`)
      .set(asUser(LEADER))
      .send({ drill: makeDrill(), endedAt });
    expect(res.status).toBe(200);
    expect(res.body.drill.endedAt).toBe(endedAt);
  });
});

describe('POST /:projectId/evacuation/build-postmortem', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${base}/build-postmortem`)
      .send({ drill: makeDrill() });
    expect(res.status).toBe(401);
  });

  it('200 builds the real postmortem with coverage capped at expected workers', async () => {
    // Ended drill: WORKER scanned, worker-3 never did → 1 of 2 = 50% final coverage.
    const drill = makeDrill({ endedAt: '2026-06-17T10:30:00.000Z' });
    const res = await request(buildApp())
      .post(`${base}/build-postmortem`)
      .set(asUser(WORKER))
      .send({ drill });
    expect(res.status).toBe(200);

    const { postmortem } = res.body;
    expect(postmortem.drillId).toBe('drill-1');
    expect(postmortem.kind).toBe('real');
    expect(postmortem.totalExpected).toBe(2);
    expect(postmortem.totalSafe).toBe(1);
    expect(postmortem.finalCoveragePercent).toBe(50);
    // 30 minutes start→end.
    expect(postmortem.totalElapsedSec).toBe(1800);
    expect(postmortem.missingWorkers).toEqual([{ uid: 'worker-3', fullName: 'Worker Three' }]);
  });
});
