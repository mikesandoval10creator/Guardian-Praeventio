// Real-router supertest for the Safety Performance Index (SPI) router.
// Mounts the ACTUAL safetyPerformance router through fakeFirestore so this is
// genuine line coverage of the production handlers (CLAUDE.md #22).
//
// Stateful endpoints under test:
//   POST /:projectId/safety-performance/safety-plan   (capture planned counts)
//   GET  /:projectId/safety-performance/spi-report     (plan-vs-executed SPI)
// Plus the pre-existing pure-compute endpoints (compute / build-trend).

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
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: { uid: string; role?: string; email?: string } }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      email: `${uid}@x.cl`,
    };
    next();
  },
}));
// Pass-through validate that still runs the real Zod schema and attaches
// req.validated (the handlers read req.validated for the stateful routes).
vi.mock('../../server/middleware/validate.js', () => ({
  validate:
    (schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }, source = 'body') =>
    (req: Request, res: Response, next: NextFunction) => {
      const input = source === 'query' ? req.query : req.body;
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        res.status(400).json({ error: 'validation_error' });
        return;
      }
      (req as Request & { validated: unknown }).validated = parsed.data;
      next();
    },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import safetyPerformanceRouter from '../../server/routes/safetyPerformance.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', safetyPerformanceRouter);
  return app;
}

const P = 'p1';
const UID = 'user1';
const PERIOD = '2026-05';
const BASE = `/api/sprint-k/${P}/safety-performance`;
const AUTH = { 'x-test-uid': UID, 'x-test-role': 'prevencionista' };

function seedProject() {
  H.db!._seed(`projects/${P}`, { tenantId: 't1' });
}

function auditRows(): Record<string, unknown>[] {
  return Object.entries(H.db!._dump())
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v as Record<string, unknown>);
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  seedProject();
});

// ──────────────────────────────────────────────────────────────────────────
// POST /safety-plan
// ──────────────────────────────────────────────────────────────────────────

describe('POST /safety-performance/safety-plan', () => {
  const validBody = {
    period: PERIOD,
    plannedInspections: 8,
    plannedDailyTalks: 22,
    plannedTrainings: 4,
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(`${BASE}/safety-plan`).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    const res = await request(buildApp())
      .post(`${BASE}/safety-plan`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 insufficient_role when caller role is not a plan writer', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/safety-plan`)
      .set({ 'x-test-uid': UID, 'x-test-role': 'worker' })
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });

  it('400 on malformed period', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/safety-plan`)
      .set(AUTH)
      .send({ ...validBody, period: 'nope' });
    expect(res.status).toBe(400);
  });

  it('200 persists the plan and stamps recordedBy from the token (not client)', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/safety-plan`)
      .set(AUTH)
      // attempt to spoof recordedBy — must be ignored (schema does not accept it)
      .send({ ...validBody, recordedBy: 'attacker' });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    const stored = (await H.db!.doc(`safety_plan_periods/${P}_${PERIOD}`).get()).data() as Record<
      string,
      unknown
    >;
    expect(stored).toBeTruthy();
    expect(stored.plannedInspections).toBe(8);
    expect(stored.recordedBy).toBe(UID);
    expect(stored.recordedBy).not.toBe('attacker');
  });

  it('200 writes an awaited audit_logs row', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/safety-plan`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    const audit = auditRows().find((r) => r.action === 'safety_performance.plan.captured');
    expect(audit).toBeTruthy();
    expect(audit).toMatchObject({ module: 'safetyPerformance', userId: UID, projectId: P });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GET /spi-report
// ──────────────────────────────────────────────────────────────────────────

describe('GET /safety-performance/spi-report', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get(`${BASE}/spi-report?period=${PERIOD}`);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    const res = await request(buildApp())
      .get(`${BASE}/spi-report?period=${PERIOD}`)
      .set(AUTH);
    expect(res.status).toBe(403);
  });

  it('400 on malformed period', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/spi-report?period=bogus`)
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  it('200 honest-empty: no plan captured → ratio indicators flagged empty', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/spi-report?period=${PERIOD}`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBeNull();
    expect(res.body.honesty.plannedInspectionsRate).toBe(true);
    expect(res.body.honesty.dailyTalksDeliveryRate).toBe(true);
    expect(res.body.honesty.trainingCurrencyRate).toBe(true);
    // No exposure captured → lagging honest-empty.
    expect(res.body.honesty.laggingEmpty).toBe(true);
    expect(res.body.report).toBeTruthy();
  });

  it('200 computes executed÷planned from REAL collections when plan captured', async () => {
    // Captured plan (denominators)
    H.db!._seed(`safety_plan_periods/${P}_${PERIOD}`, {
      projectId: P,
      period: PERIOD,
      plannedInspections: 8,
      plannedDailyTalks: 22,
      plannedTrainings: 4,
    });
    // Executed inspections (audits) — 2 completed in period, 1 out of period
    H.db!._seed('audits/a1', { projectId: P, status: 'completed', date: '2026-05-10' });
    H.db!._seed('audits/a2', { projectId: P, status: 'ejecutada', completedAt: '2026-05-20' });
    H.db!._seed('audits/a3', { projectId: P, status: 'completed', date: '2026-04-10' });
    // Executed daily talks (subcollection)
    H.db!._seed(`projects/${P}/safety_talks_given/2026-05-01__t1`, { date: '2026-05-01' });
    H.db!._seed(`projects/${P}/safety_talks_given/2026-05-02__t2`, { date: '2026-05-02' });
    // Executed trainings (completed)
    H.db!._seed('training/tr1', { projectId: P, status: 'completed', date: '2026-05-05' });
    // Near-miss
    H.db!._seed('incidents/i1', {
      projectId: P,
      incidentType: 'near_miss',
      occurredAt: '2026-05-03',
    });

    const res = await request(buildApp())
      .get(`${BASE}/spi-report?period=${PERIOD}`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ratios.inspections).toEqual({ executed: 2, planned: 8 });
    expect(res.body.ratios.dailyTalks).toEqual({ executed: 2, planned: 22 });
    expect(res.body.ratios.trainings).toEqual({ executed: 1, planned: 4 });
    expect(res.body.honesty.plannedInspectionsRate).toBe(false);
    expect(res.body.leading.nearMissReportingRate).toBe(1);
  });

  it('200 lagging TRIR/LTIFR grounded in captured exposure + classified incidents', async () => {
    H.db!._seed(`exposure_hours/${P}_${PERIOD}`, {
      projectId: P,
      period: PERIOD,
      totalHoursWorked: 200000,
    });
    H.db!._seed('incidents/i1', {
      projectId: P,
      incidentType: 'incident',
      severity: 'high',
      lostDays: 5,
      occurredAt: '2026-05-03',
    });
    const res = await request(buildApp())
      .get(`${BASE}/spi-report?period=${PERIOD}`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.exposure.totalHoursWorked).toBe(200000);
    expect(res.body.honesty.laggingEmpty).toBe(false);
    expect(res.body.lagging.trir).toBeGreaterThan(0);
    expect(res.body.lagging.lostDays).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Pre-existing pure-compute endpoints (now covered by real router test too)
// ──────────────────────────────────────────────────────────────────────────

describe('POST /safety-performance/compute (pure)', () => {
  const validBody = {
    leading: {
      preTaskChecklistCompletion: 1,
      dailyTalksDeliveryRate: 1,
      trainingCurrencyRate: 1,
      plannedInspectionsRate: 1,
      nearMissReportingRate: 5,
      positiveObservationsRate: 5,
    },
    lagging: { trir: 0, ltifr: 0, lostDays: 0, severityRate: 0, regulatoryFindings: 0 },
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(`${BASE}/compute`).send(validBody);
    expect(res.status).toBe(401);
  });

  it('200 returns a SafetyPerformanceReport', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/compute`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.report).toBeTruthy();
    expect(typeof res.body.report.spiScore).toBe('number');
  });
});
