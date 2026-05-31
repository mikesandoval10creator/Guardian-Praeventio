// Real-router supertest for readReceipts endpoints (Sprint 39 G.1).
// Six pure-compute POST routes under /:projectId/read-receipts/*.
// No Firestore writes in the happy path — assertProjectMember is the only
// Firestore read. We seed a `projects/p1` doc so the guard passes.

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

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import readReceiptsRouter from '../../server/routes/readReceipts.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', readReceiptsRouter);
  return app;
}

const MEMBER_UID = 'worker1';
const NON_MEMBER_UID = 'outsider1';
const PROJECT_ID = 'p1';

// Minimal valid fixtures
const validWorker = {
  uid: MEMBER_UID,
  role: 'operario',
  projectIds: [PROJECT_ID],
  activeTrainings: ['basic-safety'],
  isActive: true,
};

const validDoc = {
  id: 'doc1',
  version: 1,
  title: 'Procedimiento de Seguridad',
  audience: { allWorkers: true },
  publishedAt: '2026-01-01T00:00:00.000Z',
  readDeadlineDays: 30,
};

const futureDeadline = '2099-12-31T00:00:00.000Z';
const validReceipt = {
  documentId: 'doc1',
  documentVersion: 1,
  workerUid: MEMBER_UID,
  acknowledgedAt: null,
  deadlineAt: futureDeadline,
  status: 'pending' as const,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Seed project so assertProjectMember passes for MEMBER_UID
  H.db._seed(`projects/${PROJECT_ID}`, {
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
});

// ─────────────────────────────────────────────────────────────
// 1. resolve-audience
// ─────────────────────────────────────────────────────────────
describe('POST /:projectId/read-receipts/resolve-audience', () => {
  const url = `/api/${PROJECT_ID}/read-receipts/resolve-audience`;

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(url).send({
      audience: { allWorkers: true },
      workers: [],
    });
    expect(res.status).toBe(401);
  });

  it('400 missing required field (workers)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ audience: { allWorkers: true } });
    expect(res.status).toBe(400);
  });

  it('403 non-member caller', async () => {
    // outsider not in projects/p1.members
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ audience: { allWorkers: true }, workers: [] });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('200 resolves all active workers when allWorkers:true', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ audience: { allWorkers: true }, workers: [validWorker] });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.resolved)).toBe(true);
    expect((body.resolved as unknown[]).length).toBe(1);
  });

  it('200 filters out inactive workers', async () => {
    const inactiveWorker = { ...validWorker, uid: 'inactive1', isActive: false };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({
        audience: { allWorkers: true },
        workers: [validWorker, inactiveWorker],
      });
    expect(res.status).toBe(200);
    const resolved = (res.body as { resolved: unknown[] }).resolved;
    expect(resolved.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. build-initial
// ─────────────────────────────────────────────────────────────
describe('POST /:projectId/read-receipts/build-initial', () => {
  const url = `/api/${PROJECT_ID}/read-receipts/build-initial`;

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(url).send({ doc: validDoc, audience: [] });
    expect(res.status).toBe(401);
  });

  it('400 invalid doc (missing version)', async () => {
    const { version: _v, ...badDoc } = validDoc;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ doc: badDoc, audience: [validWorker] });
    expect(res.status).toBe(400);
  });

  it('403 non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ doc: validDoc, audience: [validWorker] });
    expect(res.status).toBe(403);
  });

  it('200 builds receipts for each worker in audience', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ doc: validDoc, audience: [validWorker] });
    expect(res.status).toBe(200);
    const body = res.body as { receipts: unknown[] };
    expect(Array.isArray(body.receipts)).toBe(true);
    expect(body.receipts.length).toBe(1);
    const receipt = body.receipts[0] as Record<string, unknown>;
    expect(receipt.documentId).toBe('doc1');
    expect(receipt.workerUid).toBe(MEMBER_UID);
    expect(receipt.status).toBe('pending');
    expect(receipt.acknowledgedAt).toBeNull();
  });

  it('200 empty audience yields empty receipts array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ doc: validDoc, audience: [] });
    expect(res.status).toBe(200);
    expect((res.body as { receipts: unknown[] }).receipts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. compute-deadline
// ─────────────────────────────────────────────────────────────
describe('POST /:projectId/read-receipts/compute-deadline', () => {
  const url = `/api/${PROJECT_ID}/read-receipts/compute-deadline`;

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(url).send({ publishedAt: '2026-01-01T00:00:00Z', deadlineDays: 30 });
    expect(res.status).toBe(401);
  });

  it('400 missing deadlineDays', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ publishedAt: '2026-01-01T00:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('400 deadlineDays out of range (0)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ publishedAt: '2026-01-01T00:00:00Z', deadlineDays: 0 });
    expect(res.status).toBe(400);
  });

  it('403 non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ publishedAt: '2026-01-01T00:00:00Z', deadlineDays: 30 });
    expect(res.status).toBe(403);
  });

  it('200 returns deadlineAt ISO string 30 days after publishedAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ publishedAt: '2026-01-01T00:00:00.000Z', deadlineDays: 30 });
    expect(res.status).toBe(200);
    const body = res.body as { deadlineAt: string };
    expect(typeof body.deadlineAt).toBe('string');
    // 30 days later = 2026-01-31
    expect(body.deadlineAt).toContain('2026-01-31');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. derive-status
// ─────────────────────────────────────────────────────────────
describe('POST /:projectId/read-receipts/derive-status', () => {
  const url = `/api/${PROJECT_ID}/read-receipts/derive-status`;

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(url).send({ receipt: validReceipt });
    expect(res.status).toBe(401);
  });

  it('400 invalid receipt (missing deadlineAt)', async () => {
    const { deadlineAt: _d, ...badReceipt } = validReceipt;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ receipt: badReceipt });
    expect(res.status).toBe(400);
  });

  it('403 non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ receipt: validReceipt });
    expect(res.status).toBe(403);
  });

  it('200 derives "pending" for future deadline with no ack', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ receipt: validReceipt, now: '2026-06-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('pending');
  });

  it('200 derives "overdue" for past deadline with no ack', async () => {
    const overdueReceipt = { ...validReceipt, deadlineAt: '2020-01-01T00:00:00.000Z' };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ receipt: overdueReceipt, now: '2026-06-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('overdue');
  });

  it('200 derives "acknowledged" when acknowledgedAt is present', async () => {
    const ackedReceipt = {
      ...validReceipt,
      acknowledgedAt: '2026-01-15T10:00:00.000Z',
      status: 'acknowledged' as const,
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ receipt: ackedReceipt, now: '2026-06-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('acknowledged');
  });
});

// ─────────────────────────────────────────────────────────────
// 5. acknowledge
// ─────────────────────────────────────────────────────────────
describe('POST /:projectId/read-receipts/acknowledge', () => {
  const url = `/api/${PROJECT_ID}/read-receipts/acknowledge`;

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(url).send({ receipt: validReceipt });
    expect(res.status).toBe(401);
  });

  it('400 invalid receipt body (missing workerUid)', async () => {
    const { workerUid: _w, ...badReceipt } = validReceipt;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ receipt: badReceipt });
    expect(res.status).toBe(400);
  });

  it('403 non-member caller (project membership check)', async () => {
    const receiptForNonMember = { ...validReceipt, workerUid: NON_MEMBER_UID };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ receipt: receiptForNonMember });
    expect(res.status).toBe(403);
  });

  it('403 project member cannot ack on behalf of another worker', async () => {
    // MEMBER_UID is a member but tries to ack receipt belonging to another worker
    const otherWorkerReceipt = { ...validReceipt, workerUid: 'other-worker' };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ receipt: otherWorkerReceipt });
    expect(res.status).toBe(403);
    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('forbidden');
    expect(body.message).toMatch(/only the worker themselves/i);
  });

  it('200 worker acks their own receipt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({
        receipt: validReceipt, // workerUid === MEMBER_UID
        ackedAt: '2026-06-01T12:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const body = res.body as { receipt: Record<string, unknown> };
    expect(body.receipt.acknowledgedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(body.receipt.status).toBe('acknowledged');
  });

  it('200 idempotent: already-acked receipt keeps original timestamp', async () => {
    const alreadyAcked = {
      ...validReceipt,
      acknowledgedAt: '2026-01-10T08:00:00.000Z',
      status: 'acknowledged' as const,
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ receipt: alreadyAcked, ackedAt: '2026-06-01T12:00:00.000Z' });
    expect(res.status).toBe(200);
    const body = res.body as { receipt: Record<string, unknown> };
    // idempotent: original ack timestamp preserved
    expect(body.receipt.acknowledgedAt).toBe('2026-01-10T08:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────
// 6. summarize
// ─────────────────────────────────────────────────────────────
describe('POST /:projectId/read-receipts/summarize', () => {
  const url = `/api/${PROJECT_ID}/read-receipts/summarize`;

  const pendingReceipt = { ...validReceipt };
  const ackedReceipt = {
    ...validReceipt,
    workerUid: 'worker2',
    acknowledgedAt: '2026-01-15T10:00:00.000Z',
    status: 'acknowledged' as const,
  };

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(url).send({ doc: validDoc, receipts: [] });
    expect(res.status).toBe(401);
  });

  it('400 invalid body (missing receipts array)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ doc: validDoc });
    expect(res.status).toBe(400);
  });

  it('403 non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ doc: validDoc, receipts: [] });
    expect(res.status).toBe(403);
  });

  it('200 summarizes receipts correctly (1 pending, 1 acked)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({
        doc: validDoc,
        receipts: [pendingReceipt, ackedReceipt],
        now: '2026-06-01T00:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { summary } = res.body as { summary: Record<string, unknown> };
    expect(summary.documentId).toBe('doc1');
    expect(summary.documentVersion).toBe(1);
    expect(summary.totalAudience).toBe(2);
    expect(summary.acknowledged).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.overdue).toBe(0);
    expect(summary.coveragePercent).toBe(50);
  });

  it('200 empty receipts yields 100% coverage (no audience = all done)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ doc: validDoc, receipts: [], now: '2026-06-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    const { summary } = res.body as { summary: Record<string, unknown> };
    expect(summary.totalAudience).toBe(0);
    expect(summary.coveragePercent).toBe(100);
  });

  it('200 overdue counted when deadline passed and no ack', async () => {
    const overdueReceipt = {
      ...validReceipt,
      deadlineAt: '2020-01-01T00:00:00.000Z',
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({
        doc: validDoc,
        receipts: [overdueReceipt],
        now: '2026-06-01T00:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { summary } = res.body as { summary: Record<string, unknown> };
    expect(summary.overdue).toBe(1);
    expect(summary.pending).toBe(0);
    expect(summary.coveragePercent).toBe(0);
  });
});
