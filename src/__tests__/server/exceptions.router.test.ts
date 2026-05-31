// Real-router supertest for exceptions endpoints (Sprint 39 G.2).
// Six pure-compute endpoints — no Firestore writes in the route itself, but
// assertProjectMember reads projects/{id} via admin.firestore().
// Pattern mirrors admin.router.test.ts (vi.hoisted + adminMock).

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

import exceptionsRouter from '../../server/routes/exceptions.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', exceptionsRouter);
  return app;
}

const PROJECT_ID = 'proj-test-1';
const MEMBER_UID = 'member-uid-1';
const OUTSIDER_UID = 'outsider-uid-1';
const MOUNT_PREFIX = `/api/${PROJECT_ID}/exceptions`;

// ── A full valid ExceptionRecord fixture used across multiple tests ─────────
const NOW_STR = '2026-06-01T10:00:00.000Z';
const FUTURE_STR = '2026-06-02T10:00:00.000Z';
const PAST_STR = '2025-01-01T00:00:00.000Z';

const baseRecord = {
  id: 'exc-001',
  domain: 'training_gap',
  subjectRef: { kind: 'WORKER', id: 'worker-w1' },
  reason: 'Worker needs to operate crane before refresher course is scheduled',
  alternativeMitigation: 'Supervisor present on site at all times during operation',
  approvedByUid: MEMBER_UID,
  approvedByRole: 'supervisor',
  approvedAt: NOW_STR,
  validUntil: FUTURE_STR,
  status: 'active',
} as const;

beforeEach(() => {
  H.db = createFakeFirestore();
  // Seed the project so assertProjectMember passes for MEMBER_UID
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Test Project',
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
  // OUTSIDER_UID is deliberately NOT in members
});

// ============================================================================
// POST /:projectId/exceptions/create
// ============================================================================
describe('POST /:projectId/exceptions/create', () => {
  const url = `${MOUNT_PREFIX}/create`;

  const validCreateBody = {
    id: 'exc-new-1',
    domain: 'epp_expired',
    subjectRef: { kind: 'EPP', id: 'epp-001' },
    reason: 'Replacement helmet will arrive tomorrow morning from supplier',
    alternativeMitigation: 'Worker uses backup helmet stored in site office until new one arrives',
    approvedByRole: 'supervisor',
    durationHours: 24,
    now: NOW_STR,
  };

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post(url).send(validCreateBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', OUTSIDER_UID)
      .send(validCreateBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 for schema-invalid body (missing required field)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ id: 'exc-bad', domain: 'epp_expired' }); // missing reason, etc.
    expect(res.status).toBe(400);
  });

  it('400 for invalid domain enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...validCreateBody, domain: 'not_a_real_domain' });
    expect(res.status).toBe(400);
  });

  it('200 happy path — approvedByUid forced to caller, record returned', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send(validCreateBody);
    expect(res.status).toBe(200);
    const { record } = res.body as { record: Record<string, unknown> };
    expect(record).toBeDefined();
    expect(record.id).toBe('exc-new-1');
    expect(record.domain).toBe('epp_expired');
    // Server forces approvedByUid to callerUid, ignoring any client value
    expect(record.approvedByUid).toBe(MEMBER_UID);
    expect(record.status).toBe('active');
    expect(record.approvedAt).toBeDefined();
    expect(record.validUntil).toBeDefined();
  });

  it('400 when engine throws ExceptionValidationError (reason too short)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...validCreateBody, reason: 'too short' }); // <20 chars
    // zod min(20) on reason catches this at validate() level → 400
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// POST /:projectId/exceptions/derive-status
// ============================================================================
describe('POST /:projectId/exceptions/derive-status', () => {
  const url = `${MOUNT_PREFIX}/derive-status`;

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post(url).send({ record: baseRecord });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ record: baseRecord, now: NOW_STR });
    expect(res.status).toBe(403);
  });

  it('400 for schema-invalid body (missing record)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ now: NOW_STR }); // missing record
    expect(res.status).toBe(400);
  });

  it('200 active record → status active', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ record: baseRecord, now: NOW_STR }); // now < validUntil
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('200 expired record (now past validUntil) → status expired', async () => {
    const expiredRecord = { ...baseRecord, validUntil: PAST_STR };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ record: expiredRecord, now: NOW_STR });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('expired');
  });

  it('200 revoked record → status revoked', async () => {
    const revokedRecord = {
      ...baseRecord,
      status: 'revoked',
      revokedAt: NOW_STR,
      revokedByUid: MEMBER_UID,
      revokedReason: 'Safety incident occurred',
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ record: revokedRecord, now: NOW_STR });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
  });
});

// ============================================================================
// POST /:projectId/exceptions/revoke
// ============================================================================
describe('POST /:projectId/exceptions/revoke', () => {
  const url = `${MOUNT_PREFIX}/revoke`;

  const revokeBody = {
    record: baseRecord,
    revokedReason: 'Safety inspector found conditions unsafe',
    now: NOW_STR,
  };

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post(url).send(revokeBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', OUTSIDER_UID)
      .send(revokeBody);
    expect(res.status).toBe(403);
  });

  it('400 for schema-invalid body (missing revokedReason)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ record: baseRecord }); // missing revokedReason
    expect(res.status).toBe(400);
  });

  it('200 happy path — revokedByUid forced to caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send(revokeBody);
    expect(res.status).toBe(200);
    const { record } = res.body as { record: Record<string, unknown> };
    expect(record.status).toBe('revoked');
    expect(record.revokedByUid).toBe(MEMBER_UID);
    expect(record.revokedReason).toBe('Safety inspector found conditions unsafe');
    expect(record.revokedAt).toBeDefined();
  });

  it('400 ExceptionValidationError when trying to revoke a non-active record', async () => {
    const alreadyRevoked = {
      ...baseRecord,
      status: 'revoked',
      revokedAt: NOW_STR,
      revokedByUid: 'someone',
      revokedReason: 'original reason',
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ record: alreadyRevoked, revokedReason: 'trying again', now: NOW_STR });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NOT_ACTIVE');
  });
});

// ============================================================================
// POST /:projectId/exceptions/mark-fulfilled
// ============================================================================
describe('POST /:projectId/exceptions/mark-fulfilled', () => {
  const url = `${MOUNT_PREFIX}/mark-fulfilled`;

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post(url).send({ record: baseRecord });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ record: baseRecord, now: NOW_STR });
    expect(res.status).toBe(403);
  });

  it('400 for schema-invalid body (missing record)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ now: NOW_STR }); // missing record
    expect(res.status).toBe(400);
  });

  it('200 happy path — returns fulfilled record with fulfilledAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ record: baseRecord, now: NOW_STR });
    expect(res.status).toBe(200);
    const { record } = res.body as { record: Record<string, unknown> };
    expect(record.status).toBe('fulfilled');
    expect(record.fulfilledAt).toBeDefined();
    expect(record.id).toBe('exc-001');
  });

  it('400 ExceptionValidationError when trying to fulfill a non-active record', async () => {
    const expiredRecord = {
      ...baseRecord,
      status: 'expired',
      validUntil: PAST_STR,
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ record: expiredRecord, now: NOW_STR });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NOT_ACTIVE');
  });
});

// ============================================================================
// POST /:projectId/exceptions/filter-active-at
// ============================================================================
describe('POST /:projectId/exceptions/filter-active-at', () => {
  const url = `${MOUNT_PREFIX}/filter-active-at`;

  const activeRecord = { ...baseRecord, id: 'exc-active', validUntil: FUTURE_STR };
  const expiredRecord = { ...baseRecord, id: 'exc-expired', validUntil: PAST_STR };
  const revokedRecord = {
    ...baseRecord,
    id: 'exc-revoked',
    status: 'revoked' as const,
    revokedAt: NOW_STR,
    revokedByUid: 'someone',
    revokedReason: 'revoked for test',
  };

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post(url).send({ records: [activeRecord] });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ records: [activeRecord], now: NOW_STR });
    expect(res.status).toBe(403);
  });

  it('400 for schema-invalid body (records not an array)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ records: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('200 filters to only active records', async () => {
    const records = [activeRecord, expiredRecord, revokedRecord];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ records, now: NOW_STR });
    expect(res.status).toBe(200);
    const { active } = res.body as { active: Array<Record<string, unknown>> };
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('exc-active');
  });

  it('200 returns empty array when no records are active', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ records: [expiredRecord], now: NOW_STR });
    expect(res.status).toBe(200);
    expect(res.body.active).toHaveLength(0);
  });
});

// ============================================================================
// POST /:projectId/exceptions/summarize
// ============================================================================
describe('POST /:projectId/exceptions/summarize', () => {
  const url = `${MOUNT_PREFIX}/summarize`;

  const activeRecord1 = { ...baseRecord, id: 'exc-a1', domain: 'training_gap' as const, validUntil: FUTURE_STR };
  const activeRecord2 = { ...baseRecord, id: 'exc-a2', domain: 'epp_expired' as const, validUntil: FUTURE_STR };
  const expiredRecord = { ...baseRecord, id: 'exc-e1', domain: 'training_gap' as const, validUntil: PAST_STR };

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post(url).send({ records: [] });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ records: [], now: NOW_STR });
    expect(res.status).toBe(403);
  });

  it('400 for schema-invalid body', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ records: null }); // invalid
    expect(res.status).toBe(400);
  });

  it('200 empty records — all totals zero', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ records: [], now: NOW_STR });
    expect(res.status).toBe(200);
    const { summary } = res.body as { summary: Record<string, unknown> };
    expect(summary.totalActive).toBe(0);
    expect(summary.totalExpired).toBe(0);
    expect(summary.totalRevoked).toBe(0);
    expect(summary.totalFulfilled).toBe(0);
  });

  it('200 mixed records — counts correct, byDomain populated', async () => {
    const records = [activeRecord1, activeRecord2, expiredRecord];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ records, now: NOW_STR });
    expect(res.status).toBe(200);
    const { summary } = res.body as {
      summary: {
        totalActive: number;
        totalExpired: number;
        totalRevoked: number;
        totalFulfilled: number;
        byDomain: Record<string, number>;
      };
    };
    expect(summary.totalActive).toBe(2);
    expect(summary.totalExpired).toBe(1);
    expect(summary.totalRevoked).toBe(0);
    expect(summary.totalFulfilled).toBe(0);
    expect(summary.byDomain.training_gap).toBe(2);
    expect(summary.byDomain.epp_expired).toBe(1);
  });
});
