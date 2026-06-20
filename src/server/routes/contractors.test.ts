// Praeventio Guard — contractors router behavioral tests (real router +
// supertest). Covers the pure-compute endpoints AND the stateful endpoints
// (contractor man-hours capture + per-contractor performance from REAL
// incidents + captured exposure).
//
// Exercises every status code the routes emit: 401 (no token), 403
// (non-member / insufficient role), 400 (bad payload), 200 (happy path).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@example.com`,
      role: req.header('x-test-role') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import contractorsRouter from './contractors.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', contractorsRouter);
  return app;
}

const PROJECT_ID = 'p-co-test';
const MEMBER_UID = 'uid-co-member';
const NON_MEMBER_UID = 'uid-co-stranger';
const TENANT_ID = 't-co-1';
const CID = 'contractor-7';

function seed(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Contractors Test Project',
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seed(H.db);
});

const samplePerf = {
  contractorId: CID,
  legalName: 'Constructora Andes SpA',
  manDaysWorked: 100,
  manHoursWorked: 200000,
  recordableIncidents: 2,
  lostTimeDays: 5,
  overdueActions: 1,
  trainingCompletionRate: 0.9,
  documentationCurrentRate: 0.8,
};

describe('contractorsRouter — compute-kpi (pure)', () => {
  const path = `/api/sprint-k/${PROJECT_ID}/contractors/compute-kpi`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send({ perf: samplePerf });
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ perf: { contractorId: '' } });
    expect(res.status).toBe(400);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ perf: samplePerf });
    expect(res.status).toBe(403);
  });

  it('200 computes KPI', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ perf: samplePerf });
    expect(res.status).toBe(200);
    expect(res.body.kpi.contractorId).toBe(CID);
    expect(typeof res.body.kpi.trir).toBe('number');
  });
});

describe('contractorsRouter — contractor exposure capture', () => {
  const path = `/api/sprint-k/${PROJECT_ID}/contractors/exposure`;
  const body = {
    contractorId: CID,
    contractorName: 'Constructora Andes SpA',
    period: '2026-05',
    totalHoursWorked: 120000,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send(body);
    expect(res.status).toBe(401);
  });

  it('400 on invalid period', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'prevencionista')
      .send({ ...body, period: '2026-5' });
    expect(res.status).toBe(400);
  });

  it('400 on contractorId containing a slash (path-traversal guard)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'prevencionista')
      .send({ ...body, contractorId: 'a/b' });
    expect(res.status).toBe(400);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .set('x-test-role', 'prevencionista')
      .send(body);
    expect(res.status).toBe(403);
  });

  it('403 for a member with insufficient role (worker)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'worker')
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });

  it('200 captures man-hours, server-stamps recordedBy, writes audit_log', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'prevencionista')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: true, contractorId: CID, period: '2026-05', totalHoursWorked: 120000 });

    const docId = `${PROJECT_ID}_${CID}_2026-05`;
    const saved = await H.db!.collection('contractor_exposure_hours').doc(docId).get();
    expect(saved.exists).toBe(true);
    expect(saved.data()!.recordedBy).toBe(MEMBER_UID); // server-stamped, not client
    expect(saved.data()!.totalHoursWorked).toBe(120000);
  });
});

describe('contractorsRouter — performance (real incidents + exposure)', () => {
  const perfPath = `/api/sprint-k/${PROJECT_ID}/contractors/performance`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`${perfPath}?period=2026-05`);
    expect(res.status).toBe(401);
  });

  it('400 on missing/invalid period query', async () => {
    const res = await request(buildApp()).get(perfPath).set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(400);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .get(`${perfPath}?period=2026-05`)
      .set('x-test-uid', NON_MEMBER_UID);
    expect(res.status).toBe(403);
  });

  it('200 honest empty roster when nothing captured', async () => {
    const res = await request(buildApp())
      .get(`${perfPath}?period=2026-05`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.contractors).toEqual([]);
  });

  it('200 computes per-contractor TRIR from REAL contractor-attributed incidents', async () => {
    // Capture exposure for one contractor.
    H.db!._seed(`contractor_exposure_hours/${PROJECT_ID}_${CID}_2026-05`, {
      projectId: PROJECT_ID,
      contractorId: CID,
      contractorName: 'Constructora Andes SpA',
      period: '2026-05',
      totalHoursWorked: 200000,
    });
    // Real incidents (nested path) in the period — i1/i2 attributed to CID, i3
    // attributed to NOBODY (no contractorId → must NOT be counted onto CID).
    const base = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/incidents`;
    H.db!._seed(`${base}/i1`, {
      incidentType: 'incident',
      severity: 'high',
      lostDays: 3,
      contractorId: CID,
      ts: '2026-05-10T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    H.db!._seed(`${base}/i2`, {
      incidentType: 'incident',
      severity: 'critical',
      contractorId: CID,
      ts: '2026-05-20T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    H.db!._seed(`${base}/i3`, {
      incidentType: 'incident', // no contractorId — honest: not attributed
      severity: 'high',
      ts: '2026-05-21T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    H.db!._seed(`${base}/i4`, {
      incidentType: 'near_miss', // not recordable
      severity: 'low',
      contractorId: CID,
      ts: '2026-05-22T09:00:00.000Z',
      projectId: PROJECT_ID,
    });

    const res = await request(buildApp())
      .get(`${perfPath}?period=2026-05`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.contractors).toHaveLength(1);
    const row = res.body.contractors[0];
    expect(row.contractorId).toBe(CID);
    expect(row.counts.totalRecordable).toBe(2); // i1, i2 (not i3=unattributed, not i4=near_miss)
    expect(row.totalHoursWorked).toBe(200000);
    // TRIR = 2 * 200000 / 200000 = 2
    expect(row.report.trir).toBe(2);
  });
});
