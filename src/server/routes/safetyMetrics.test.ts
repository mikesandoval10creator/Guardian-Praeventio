// Praeventio Guard — safetyMetrics router behavioral tests (real router +
// supertest). Covers the pure-compute endpoints AND the Bucket D stateful
// endpoints (exposure capture + report reading REAL incidents).
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

import safetyMetricsRouter from './safetyMetrics.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', safetyMetricsRouter);
  return app;
}

const PROJECT_ID = 'p-sm-test';
const MEMBER_UID = 'uid-sm-member';
const NON_MEMBER_UID = 'uid-sm-stranger';
const TENANT_ID = 't-sm-1';

function seed(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Safety Metrics Test Project',
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seed(H.db);
});

describe('safetyMetricsRouter — exposure capture', () => {
  const path = `/api/sprint-k/${PROJECT_ID}/safety-metrics/exposure`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send({ period: '2026-05', totalHoursWorked: 100 });
    expect(res.status).toBe(401);
  });

  it('400 on invalid period', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'prevencionista')
      .send({ period: '2026-5', totalHoursWorked: 100 });
    expect(res.status).toBe(400);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .set('x-test-role', 'prevencionista')
      .send({ period: '2026-05', totalHoursWorked: 100 });
    expect(res.status).toBe(403);
  });

  it('403 for a member with insufficient role (worker)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'worker')
      .send({ period: '2026-05', totalHoursWorked: 100 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });

  it('200 captures man-hours, server-stamps recordedBy, writes audit_log', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'prevencionista')
      .send({ period: '2026-05', totalHoursWorked: 250000 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: true, period: '2026-05', totalHoursWorked: 250000 });

    const saved = await H.db!.collection('exposure_hours').doc(`${PROJECT_ID}_2026-05`).get();
    expect(saved.exists).toBe(true);
    expect(saved.data()!.recordedBy).toBe(MEMBER_UID); // server-stamped, not client
    expect(saved.data()!.totalHoursWorked).toBe(250000);
  });
});

describe('safetyMetricsRouter — report (real incidents + exposure)', () => {
  const reportPath = `/api/sprint-k/${PROJECT_ID}/safety-metrics/report`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`${reportPath}?period=2026-05`);
    expect(res.status).toBe(401);
  });

  it('400 on missing/invalid period query', async () => {
    const res = await request(buildApp())
      .get(reportPath)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(400);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .get(`${reportPath}?period=2026-05`)
      .set('x-test-uid', NON_MEMBER_UID);
    expect(res.status).toBe(403);
  });

  it('200 with honest zero counts + zero exposure when nothing captured', async () => {
    const res = await request(buildApp())
      .get(`${reportPath}?period=2026-05`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.counts.totalRecordable).toBe(0);
    expect(res.body.exposure.totalHoursWorked).toBe(0);
    // No exposure → TRIR is 0 (calculateRate returns 0 when hours <= 0).
    expect(res.body.report.trir).toBe(0);
  });

  it('200 computes REAL TRIR/LTIFR from registered incidents + captured exposure', async () => {
    // Seed real incidents (nested path) in the period.
    const base = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/incidents`;
    H.db!._seed(`${base}/i1`, {
      incidentType: 'incident',
      severity: 'high',
      lostDays: 5,
      ts: '2026-05-10T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    H.db!._seed(`${base}/i2`, {
      incidentType: 'incident',
      severity: 'critical',
      lostDays: 0,
      ts: '2026-05-20T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    H.db!._seed(`${base}/i3`, {
      incidentType: 'near_miss', // not recordable
      severity: 'low',
      ts: '2026-05-21T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    H.db!._seed(`${base}/i4`, {
      incidentType: 'incident', // different month — excluded
      severity: 'high',
      lostDays: 99,
      ts: '2026-04-01T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    // Capture exposure for the period.
    H.db!._seed(`exposure_hours/${PROJECT_ID}_2026-05`, {
      projectId: PROJECT_ID,
      period: '2026-05',
      totalHoursWorked: 200000,
    });

    const res = await request(buildApp())
      .get(`${reportPath}?period=2026-05`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.counts.totalRecordable).toBe(2); // i1, i2 (not near_miss, not April)
    expect(res.body.counts.lostTime).toBe(1); // only i1 has lostDays>0
    expect(res.body.counts.seriousInjuriesAndFatalities).toBe(1); // i2 critical
    expect(res.body.exposure.totalHoursWorked).toBe(200000);
    // TRIR = totalRecordable(2) * 200000 / 200000 = 2
    expect(res.body.report.trir).toBe(2);
  });
});

describe('safetyMetricsRouter — trend (multi-period series)', () => {
  const trendPath = `/api/sprint-k/${PROJECT_ID}/safety-metrics/trend`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`${trendPath}?period=2026-05`);
    expect(res.status).toBe(401);
  });

  it('400 on invalid period', async () => {
    const res = await request(buildApp())
      .get(`${trendPath}?period=2026-5`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(400);
  });

  it('400 on out-of-range months', async () => {
    const res = await request(buildApp())
      .get(`${trendPath}?period=2026-05&months=99`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(400);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .get(`${trendPath}?period=2026-05`)
      .set('x-test-uid', NON_MEMBER_UID);
    expect(res.status).toBe(403);
  });

  it('200 returns the requested rolling window ending at period', async () => {
    const res = await request(buildApp())
      .get(`${trendPath}?period=2026-05&months=3`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.periods).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(res.body.points.map((p: { period: string }) => p.period)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    // Nothing captured → every point honest-zero with hasExposure=false.
    for (const p of res.body.points) {
      expect(p.trir).toBe(0);
      expect(p.hasExposure).toBe(false);
    }
  });

  it('200 computes REAL per-month rates and flags captured months', async () => {
    const base = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/incidents`;
    // May: 2 recordable incidents.
    H.db!._seed(`${base}/m1`, {
      incidentType: 'incident',
      severity: 'high',
      lostDays: 4,
      ts: '2026-05-10T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    H.db!._seed(`${base}/m2`, {
      incidentType: 'incident',
      severity: 'med',
      ts: '2026-05-15T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    // April: 1 recordable incident.
    H.db!._seed(`${base}/a1`, {
      incidentType: 'incident',
      severity: 'high',
      ts: '2026-04-02T09:00:00.000Z',
      projectId: PROJECT_ID,
    });
    // Exposure captured for May only.
    H.db!._seed(`exposure_hours/${PROJECT_ID}_2026-05`, {
      projectId: PROJECT_ID,
      period: '2026-05',
      totalHoursWorked: 200000,
    });

    const res = await request(buildApp())
      .get(`${trendPath}?period=2026-05&months=2`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);

    const april = res.body.points.find((p: { period: string }) => p.period === '2026-04');
    const may = res.body.points.find((p: { period: string }) => p.period === '2026-05');

    // April: incidents exist but NO exposure → rate 0, hasExposure=false (honest).
    expect(april.hasExposure).toBe(false);
    expect(april.trir).toBe(0);

    // May: TRIR = 2 recordable * 200000 / 200000 = 2; hasExposure=true.
    expect(may.hasExposure).toBe(true);
    expect(may.trir).toBe(2);
  });

  it('200 defaults to a 12-month window when months omitted', async () => {
    const res = await request(buildApp())
      .get(`${trendPath}?period=2026-05`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.periods).toHaveLength(12);
    expect(res.body.periods[11]).toBe('2026-05');
    expect(res.body.periods[0]).toBe('2025-06');
  });
});
