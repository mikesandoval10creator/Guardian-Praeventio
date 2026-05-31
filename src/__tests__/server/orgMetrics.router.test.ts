// Real-router supertest for orgMetrics endpoints.
// Five pure-compute POST endpoints — no Firestore writes; only
// `assertProjectMember` reads from the projects collection.

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

import orgMetricsRouter from '../../server/routes/orgMetrics.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', orgMetricsRouter);
  return app;
}

const PROJECT_ID = 'proj-abc';
const MEMBER_UID = 'user-member';
const OUTSIDER_UID = 'user-outsider';

beforeEach(() => {
  H.db = createFakeFirestore();
  // Seed a project with a known member
  H.db._seed(`projects/${PROJECT_ID}`, {
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/org-metrics/detect-silos
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/org-metrics/detect-silos', () => {
  const path = `/api/${PROJECT_ID}/org-metrics/detect-silos`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(path).send({ signals: [] });
    expect(res.status).toBe(401);
  });

  it('400 — schema invalid (signals item missing required fields)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: [{ module: 'X' }] }); // missing outboundEvents etc.
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 — caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ signals: [] });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('200 — returns reports array for valid signals', async () => {
    const signals = [
      {
        module: 'inspecciones',
        outboundEvents: 100,
        inboundEvents: 80,
        expectedPeers: ['acciones', 'documentos'],
        actualPeers: ['acciones'],
      },
    ];
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals });
    expect(res.status).toBe(200);
    const body = res.body as { reports: unknown[] };
    expect(Array.isArray(body.reports)).toBe(true);
    expect(body.reports).toHaveLength(1);
    const report = body.reports[0] as Record<string, unknown>;
    expect(report.module).toBe('inspecciones');
    expect(typeof report.siloScore).toBe('number');
    expect(Array.isArray(report.missingPeers)).toBe(true);
  });

  it('200 — empty signals array returns empty reports', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: [] });
    expect(res.status).toBe(200);
    expect((res.body as { reports: unknown[] }).reports).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/org-metrics/build-friction-report
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/org-metrics/build-friction-report', () => {
  const path = `/api/${PROJECT_ID}/org-metrics/build-friction-report`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(path).send({ samples: [] });
    expect(res.status).toBe(401);
  });

  it('400 — schema invalid (unknown process value)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        samples: [
          {
            process: 'not_a_real_process',
            flowId: 'f1',
            startedAt: '2026-05-01T00:00:00Z',
            isStuck: false,
          },
        ],
      });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 — caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ samples: [] });
    expect(res.status).toBe(403);
  });

  it('200 — returns friction reports for valid samples', async () => {
    const samples = [
      {
        process: 'doc_approval',
        flowId: 'f1',
        startedAt: '2026-05-01T00:00:00Z',
        completedAt: '2026-05-04T00:00:00Z',
        isStuck: false,
      },
      {
        process: 'doc_approval',
        flowId: 'f2',
        startedAt: '2026-05-01T00:00:00Z',
        isStuck: true,
      },
    ];
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ samples });
    expect(res.status).toBe(200);
    const body = res.body as { reports: unknown[] };
    expect(Array.isArray(body.reports)).toBe(true);
    expect(body.reports).toHaveLength(1);
    const report = body.reports[0] as Record<string, unknown>;
    expect(report.process).toBe('doc_approval');
    expect(typeof report.stuckPercent).toBe('number');
    expect(typeof report.hasFriction).toBe('boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/org-metrics/build-closure-time-report
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/org-metrics/build-closure-time-report', () => {
  const path = `/api/${PROJECT_ID}/org-metrics/build-closure-time-report`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(path).send({ gaps: [] });
    expect(res.status).toBe(401);
  });

  it('400 — schema invalid (unknown kind value)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        gaps: [{ kind: 'bad_kind', openedAt: '2026-05-01', closedAt: '2026-05-10' }],
      });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 — caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ gaps: [] });
    expect(res.status).toBe(403);
  });

  it('200 — returns closure time reports for valid gaps', async () => {
    const gaps = [
      { kind: 'critical_action', openedAt: '2026-05-01T00:00:00Z', closedAt: '2026-05-05T00:00:00Z' },
      { kind: 'critical_action', openedAt: '2026-05-01T00:00:00Z', closedAt: '2026-05-11T00:00:00Z' },
      { kind: 'training_gap', openedAt: '2026-05-01T00:00:00Z', closedAt: '2026-05-08T00:00:00Z' },
    ];
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ gaps });
    expect(res.status).toBe(200);
    const body = res.body as { reports: unknown[] };
    expect(Array.isArray(body.reports)).toBe(true);
    expect(body.reports).toHaveLength(2);
    const criticalReport = (body.reports as Record<string, unknown>[]).find(
      (r) => r.kind === 'critical_action',
    );
    expect(criticalReport).toBeDefined();
    expect(typeof criticalReport!.avgDays).toBe('number');
    expect(typeof criticalReport!.medianDays).toBe('number');
    expect(typeof criticalReport!.p90Days).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/org-metrics/detect-chronic-gaps
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/org-metrics/detect-chronic-gaps', () => {
  const path = `/api/${PROJECT_ID}/org-metrics/detect-chronic-gaps`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(path).send({ history: [] });
    expect(res.status).toBe(401);
  });

  it('400 — schema invalid (location too long)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        history: [
          {
            location: 'x'.repeat(301),
            category: 'orden_aseo',
            inspectionAt: '2026-05-01',
            foundProblem: true,
          },
        ],
      });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 — caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ history: [] });
    expect(res.status).toBe(403);
  });

  it('200 — returns empty array when no chronic gaps found', async () => {
    const history = [
      { location: 'bodega', category: 'orden', inspectionAt: '2026-05-01', foundProblem: false },
      { location: 'bodega', category: 'orden', inspectionAt: '2026-05-08', foundProblem: false },
    ];
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ history });
    expect(res.status).toBe(200);
    // No problem found → not chronic
    expect((res.body as { reports: unknown[] }).reports).toHaveLength(0);
  });

  it('200 — identifies chronic gap when ≥3 consecutive detections', async () => {
    const history = [
      { location: 'planta-norte', category: 'orden_aseo', inspectionAt: '2026-04-01', foundProblem: true },
      { location: 'planta-norte', category: 'orden_aseo', inspectionAt: '2026-04-08', foundProblem: true },
      { location: 'planta-norte', category: 'orden_aseo', inspectionAt: '2026-04-15', foundProblem: true },
    ];
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ history });
    expect(res.status).toBe(200);
    const body = res.body as { reports: unknown[] };
    expect(body.reports).toHaveLength(1);
    const report = body.reports[0] as Record<string, unknown>;
    expect(report.location).toBe('planta-norte');
    expect(report.isChronic).toBe(true);
    expect(report.consecutiveDetections).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/org-metrics/compute-operational-pressure
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /:projectId/org-metrics/compute-operational-pressure', () => {
  const path = `/api/${PROJECT_ID}/org-metrics/compute-operational-pressure`;

  const validSignals = {
    overdueTasks: 10,
    overtimeHoursWeekTotal: 200,
    minorIncidentsLast7d: 5,
    absenteeismRate: 0.15,
    hasNightShift: true,
    hasAdverseWeather: false,
    totalActiveWorkers: 50,
  };

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(path).send({ signals: validSignals });
    expect(res.status).toBe(401);
  });

  it('400 — schema invalid (absenteeismRate > 1)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: { ...validSignals, absenteeismRate: 1.5 } });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 — schema invalid (missing required field signals)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 — caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', OUTSIDER_UID)
      .send({ signals: validSignals });
    expect(res.status).toBe(403);
  });

  it('200 — returns PressureReport with expected shape', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: validSignals });
    expect(res.status).toBe(200);
    const body = res.body as { report: Record<string, unknown> };
    expect(typeof body.report.pressureScore).toBe('number');
    expect(['low', 'medium', 'high', 'critical']).toContain(body.report.level);
    expect(Array.isArray(body.report.topDrivers)).toBe(true);
  });

  it('200 — zero-pressure signals yield low level', async () => {
    const zeroSignals = {
      overdueTasks: 0,
      overtimeHoursWeekTotal: 0,
      minorIncidentsLast7d: 0,
      absenteeismRate: 0,
      hasNightShift: false,
      hasAdverseWeather: false,
      totalActiveWorkers: 10,
    };
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: zeroSignals });
    expect(res.status).toBe(200);
    const report = (res.body as { report: Record<string, unknown> }).report;
    expect(report.pressureScore).toBe(0);
    expect(report.level).toBe('low');
    expect((report.topDrivers as unknown[]).length).toBe(0);
  });

  it('200 — all high-stress signals yield critical or high level', async () => {
    const maxSignals = {
      overdueTasks: 50,
      overtimeHoursWeekTotal: 1000,
      minorIncidentsLast7d: 10,
      absenteeismRate: 0.4,
      hasNightShift: true,
      hasAdverseWeather: true,
      totalActiveWorkers: 50,
    };
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: maxSignals });
    expect(res.status).toBe(200);
    const report = (res.body as { report: Record<string, unknown> }).report;
    expect(['high', 'critical']).toContain(report.level);
    expect((report.topDrivers as unknown[]).length).toBeGreaterThan(0);
  });
});
