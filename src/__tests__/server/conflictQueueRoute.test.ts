// Real-router supertest for B16 conflict_queue durable persistence. Drives the
// REAL engine (src/services/sync/conflictQueue.ts — UNMOCKED) + REAL route over
// fakeFirestore; only middleware is stubbed (same set as offlineInspections.test).
//
// Covers: 401 (no token), 403 (non-member), 403 (approver gate — worker can't
// resolve/reject/mark-in-review), 201 enqueue persists with server-stamped
// localAuthorUid (NOT body), idempotent re-enqueue (deterministic queueId →
// same doc), engine gate (non-critical → not persisted), resolve→audit,
// INCOMPLETE_RESOLUTION / ALREADY_FINALIZED 409s, list filter.

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
    (req as Request & { user: { uid: string; role?: string } }).user = {
      uid,
      role: req.header('x-test-role') ?? 'worker',
    };
    next();
  },
}));
vi.mock('../../server/middleware/validate.js', () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import conflictQueueRouter from '../../server/routes/conflictQueue.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', conflictQueueRouter);
  return app;
}

const worker = { 'x-test-uid': 'w1', 'x-test-role': 'worker' };
const adminUser = { 'x-test-uid': 'a1', 'x-test-role': 'admin' };
const QUEUE = 'tenants/t1/conflict_queue';

const criticalConflict = {
  collection: 'incident_reports',
  docId: 'inc-1',
  docType: 'IncidentReport',
  localUpdatedAt: '2026-01-01T00:00:00Z',
  serverUpdatedAt: '2026-01-01T00:01:00Z',
  isDeletionConflict: false,
  fields: [{ field: 'severity', localValue: 'high', remoteValue: 'medium', critical: true }],
};
const nonCriticalConflict = {
  ...criticalConflict,
  docType: 'RiskNode',
  docId: 'node-9',
  fields: [{ field: 'description', localValue: 'a', remoteValue: 'b', critical: false }],
};

function queueKeys() {
  return Object.keys(H.db!._dump()).filter((k) => k.startsWith(QUEUE));
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('enqueue', () => {
  it('401 without token', async () => {
    const r = await request(buildApp())
      .post('/api/sprint-k/p1/conflict-queue/enqueue')
      .send({ conflict: criticalConflict });
    expect(r.status).toBe(401);
  });

  it('403 for non-member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    const r = await request(buildApp())
      .post('/api/sprint-k/p1/conflict-queue/enqueue')
      .set(worker)
      .send({ conflict: criticalConflict });
    expect(r.status).toBe(403);
  });

  it('201 persists with server-stamped localAuthorUid (NOT body) and is idempotent', async () => {
    const r = await request(buildApp())
      .post('/api/sprint-k/p1/conflict-queue/enqueue')
      .set(worker)
      .send({ conflict: criticalConflict, localAuthorUid: 'attacker' });
    expect(r.status).toBe(201);
    expect(r.body.entry.localAuthorUid).toBe('w1');
    expect(queueKeys()).toHaveLength(1);
    const stored = H.db!._dump()[queueKeys()[0]] as { localAuthorUid: string };
    expect(stored.localAuthorUid).toBe('w1');
    // retry the SAME conflict → idempotent, no second doc (stable queueId).
    const retry = await request(buildApp())
      .post('/api/sprint-k/p1/conflict-queue/enqueue')
      .set(worker)
      .send({ conflict: criticalConflict });
    expect(retry.status).toBe(200);
    expect(retry.body.enqueued).toBe(false);
    expect(queueKeys()).toHaveLength(1);
  });

  it('200 enqueued:false for a non-critical conflict (engine gate)', async () => {
    const r = await request(buildApp())
      .post('/api/sprint-k/p1/conflict-queue/enqueue')
      .set(worker)
      .send({ conflict: nonCriticalConflict });
    expect(r.status).toBe(200);
    expect(r.body.enqueued).toBe(false);
    expect(queueKeys()).toHaveLength(0);
  });

  it('writes an audit_logs row on enqueue', async () => {
    await request(buildApp())
      .post('/api/sprint-k/p1/conflict-queue/enqueue')
      .set(worker)
      .send({ conflict: criticalConflict });
    const audits = Object.keys(H.db!._dump()).filter((k) => k.startsWith('audit_logs/'));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

describe('approver gate + transitions', () => {
  async function enqueue(conflict = criticalConflict): Promise<string> {
    const r = await request(buildApp())
      .post('/api/sprint-k/p1/conflict-queue/enqueue')
      .set(worker)
      .send({ conflict });
    return r.body.entry.queueId as string;
  }

  it('403 when a worker tries to resolve/reject/mark-in-review', async () => {
    const id = await enqueue();
    expect(
      (
        await request(buildApp())
          .post(`/api/sprint-k/p1/conflict-queue/${id}/resolve`)
          .set(worker)
          .send({ resolution: { severity: { chosen: 'remote', value: 'medium' } } })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(buildApp())
          .post(`/api/sprint-k/p1/conflict-queue/${id}/reject`)
          .set(worker)
          .send({ reason: 'duplicate report from sync race' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(buildApp())
          .post(`/api/sprint-k/p1/conflict-queue/${id}/mark-in-review`)
          .set(worker)
          .send({})
      ).status,
    ).toBe(403);
  });

  it('admin resolves (status→resolved) + audit, then 409 on re-resolve', async () => {
    const id = await enqueue();
    const r = await request(buildApp())
      .post(`/api/sprint-k/p1/conflict-queue/${id}/resolve`)
      .set(adminUser)
      .send({
        resolution: { severity: { chosen: 'remote', value: 'medium' } },
        notes: 'remote correct after review',
      });
    expect(r.status).toBe(200);
    expect(r.body.entry.status).toBe('resolved');
    expect(r.body.entry.resolvedByUid).toBe('a1');
    const again = await request(buildApp())
      .post(`/api/sprint-k/p1/conflict-queue/${id}/resolve`)
      .set(adminUser)
      .send({ resolution: { severity: { chosen: 'local', value: 'high' } } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('ALREADY_FINALIZED');
  });

  it('409 INCOMPLETE_RESOLUTION when a critical field is omitted', async () => {
    const id = await enqueue({
      ...criticalConflict,
      docId: 'inc-2',
      fields: [
        { field: 'severity', localValue: 'high', remoteValue: 'medium', critical: true },
        { field: 'status', localValue: 'open', remoteValue: 'closed', critical: true },
      ],
    });
    const r = await request(buildApp())
      .post(`/api/sprint-k/p1/conflict-queue/${id}/resolve`)
      .set(adminUser)
      .send({ resolution: { severity: { chosen: 'local', value: 'high' } } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('INCOMPLETE_RESOLUTION');
  });

  it('mark-in-review then reject transitions to rejected', async () => {
    const id = await enqueue();
    const review = await request(buildApp())
      .post(`/api/sprint-k/p1/conflict-queue/${id}/mark-in-review`)
      .set(adminUser)
      .send({});
    expect(review.status).toBe(200);
    expect(review.body.entry.status).toBe('in_review');
    const ok = await request(buildApp())
      .post(`/api/sprint-k/p1/conflict-queue/${id}/reject`)
      .set(adminUser)
      .send({ reason: 'Duplicate report from sync race' });
    expect(ok.status).toBe(200);
    expect(ok.body.entry.status).toBe('rejected');
  });

  it('reject with an engine-too-short reason → 409 REASON_TOO_SHORT', async () => {
    // `validate` is mocked passthrough here, so an empty/short reason reaches
    // the engine inside runTransaction; rejectAsInvalid requires >=5 chars and
    // throws ConflictQueueValidationError('REASON_TOO_SHORT') → mapped to 409.
    const id = await enqueue();
    const r = await request(buildApp())
      .post(`/api/sprint-k/p1/conflict-queue/${id}/reject`)
      .set(adminUser)
      .send({ reason: 'no' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('REASON_TOO_SHORT');
  });

  it('404 transitioning a missing queueId', async () => {
    expect(
      (
        await request(buildApp())
          .post('/api/sprint-k/p1/conflict-queue/missing/resolve')
          .set(adminUser)
          .send({ resolution: {} })
      ).status,
    ).toBe(404);
  });
});

describe('list', () => {
  it('lists entries filtered by projectId + status', async () => {
    await request(buildApp())
      .post('/api/sprint-k/p1/conflict-queue/enqueue')
      .set(worker)
      .send({ conflict: criticalConflict });
    const r = await request(buildApp())
      .get('/api/sprint-k/p1/conflict-queue?status=pending')
      .set(worker);
    expect(r.status).toBe(200);
    expect(r.body.entries).toHaveLength(1);
    expect(r.body.entries[0].status).toBe('pending');
  });
});
