// Real-router supertest for src/server/routes/sif.ts (B4).
//
// SIF = Serious Injury/Fatality precursor executive review. The review is an
// accountability record, so the reviewer identity (reviewedByUid) and the
// timestamp (reviewedAt) MUST be server-stamped from the verified token +
// server clock — never the request body. This pins that: even when the body
// forges reviewedByUid/reviewedAt, the recorded values come from the caller.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  recordMock: vi.fn(async (..._args: unknown[]) => {}),
  listMock: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../server/middleware/auditLog.js', () => ({ auditServerEvent: vi.fn(async () => true) }));
// SIFAdapter is mocked so we can assert the exact (id, reviewedByUid, reviewedAt, notes)
// the route passes — the security contract is in those arguments. A plain class
// keeps it `new`-able (vi.fn arrow implementations are not constructors).
vi.mock('../../services/sif/sifFirestoreAdapter.js', () => ({
  SIFAdapter: class {
    recordExecutiveReview(...args: unknown[]) { return H.recordMock(...args); }
    listPendingExecutiveReview(...args: unknown[]) { return H.listMock(...args); }
  },
}));

import sifRouter from '../../server/routes/sif.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PID = 'proj-sif-1';
const CALLER = 'u-exec-1';
const REVIEW_URL = `/api/sprint-k/${PID}/sif/precursor-9/executive-review`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', sifRouter);
  return app;
}
const as = (uid: string) => ({ 'x-test-uid': uid });

beforeEach(() => {
  H.db = createFakeFirestore();
  H.recordMock.mockClear();
  H.listMock.mockClear();
  // Project with the caller as a member + a tenant binding.
  H.db._seed(`projects/${PID}`, { createdBy: CALLER, members: [CALLER], tenantId: 't1' });
});

describe('POST /:projectId/sif/:id/executive-review — identity from token (B4)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(REVIEW_URL).send({ reviewNotes: 'x' });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp()).post(REVIEW_URL).set(as('outsider')).send({ reviewNotes: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(H.recordMock).not.toHaveBeenCalled();
  });

  it('204 happy path — records reviewer = caller and reviewedAt = server clock, ignoring forged body fields', async () => {
    const before = Date.now();
    const res = await request(buildApp())
      .post(REVIEW_URL)
      .set(as(CALLER))
      // Attacker tries to attribute the review to someone else + backdate it.
      .send({ reviewedByUid: 'u-other-exec', reviewedAt: '2020-01-01T00:00:00Z', reviewNotes: 'reviewed ok' });
    expect(res.status).toBe(204);
    expect(H.recordMock).toHaveBeenCalledTimes(1);
    const [id, reviewedByUid, reviewedAt, notes] = H.recordMock.mock.calls[0] as unknown as [string, string, string, string];
    expect(id).toBe('precursor-9');
    // Reviewer is the authenticated caller, NOT the forged body value.
    expect(reviewedByUid).toBe(CALLER);
    expect(reviewedByUid).not.toBe('u-other-exec');
    // Timestamp is the server clock, NOT the backdated body value.
    expect(reviewedAt).not.toBe('2020-01-01T00:00:00Z');
    expect(Date.parse(reviewedAt)).toBeGreaterThanOrEqual(before);
    expect(notes).toBe('reviewed ok');
  });

  it('404 when the project has no tenant binding', async () => {
    H.db!._seed(`projects/${PID}`, { createdBy: CALLER, members: [CALLER] }); // no tenantId
    const res = await request(buildApp()).post(REVIEW_URL).set(as(CALLER)).send({ reviewNotes: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });
});
