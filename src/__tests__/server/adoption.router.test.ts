// Real-router supertest for the Product Adoption Analytics HTTP surface
// (src/server/routes/adoption.ts). Four stateless POST endpoints over the pure
// engine in src/services/adoption/adoptionAnalytics.ts:
//
//   POST /:projectId/adoption/module-adoption  → { report }
//   POST /:projectId/adoption/funnel           → { report }
//   POST /:projectId/adoption/churn-risk        → { report }
//   POST /:projectId/adoption/first-value       → { report }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real compute. Each happy
// path re-derives the expected output from the engine semantics (counts,
// percentages, churn scoring, first-value averages) rather than copying the
// handler — the engine math is reproduced from src/services/adoption only.
//
// The router accepts `activeModules` as string[] on the wire and converts to a
// Set before invoking the engine (the engine type is Set<ModuleUsageKind>), so
// the tests send arrays and assert the engine's Set-driven counts.

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
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import adoptionRouter from '../../server/routes/adoption.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type { TenantUsageSnapshot } from '../../services/adoption/adoptionAnalytics.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', adoptionRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A valid wire snapshot (activeModules is a string[] on the wire). Override
// fields per test. `tenantId` etc. are realistic so validation passes.
function wireSnapshot(over: Partial<{
  tenantId: string;
  snapshotAt: string;
  daysSinceSignup: number;
  activeModules: string[];
  events30d: number;
  activeWorkers: number;
  activeProjects: number;
  hasPaidPlan: boolean;
}> = {}) {
  return {
    tenantId: 't1',
    snapshotAt: '2026-05-01T00:00:00.000Z',
    daysSinceSignup: 10,
    activeModules: ['projects', 'workers'],
    events30d: 100,
    activeWorkers: 5,
    activeProjects: 2,
    hasPaidPlan: true,
    ...over,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. module-adoption
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/adoption/module-adoption', () => {
  const url = '/api/p1/adoption/module-adoption';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ snapshots: [] });
    expect(res.status).toBe(401);
  });

  it('200 derives per-module adopters + rounded adoption percent from the real engine', async () => {
    // 3 tenants. `projects` used by t1+t2 (2/3 → round(66.66)=67%), `incidents`
    // by t1 only (1/3 → round(33.33)=33%), `cphs` by nobody (0%).
    const snapshots = [
      wireSnapshot({ tenantId: 't1', activeModules: ['projects', 'incidents'] }),
      wireSnapshot({ tenantId: 't2', activeModules: ['projects'] }),
      wireSnapshot({ tenantId: 't3', activeModules: ['workers'] }),
    ];
    const res = await request(buildApp()).post(url).set(uid).send({ snapshots });
    expect(res.status).toBe(200);
    expect(res.body.report.totalTenants).toBe(3);
    expect(res.body.report.byModule.projects).toEqual({ adopters: 2, adoptionPercent: 67 });
    expect(res.body.report.byModule.incidents).toEqual({ adopters: 1, adoptionPercent: 33 });
    expect(res.body.report.byModule.workers).toEqual({ adopters: 1, adoptionPercent: 33 });
    expect(res.body.report.byModule.cphs).toEqual({ adopters: 0, adoptionPercent: 0 });
    // All 11 module keys present even when totally unused.
    expect(Object.keys(res.body.report.byModule)).toHaveLength(11);
  });

  it('200 handles the empty-snapshots edge: 0 adopters, 0% (no divide-by-zero)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ snapshots: [] });
    expect(res.status).toBe(200);
    expect(res.body.report.totalTenants).toBe(0);
    expect(res.body.report.byModule.projects).toEqual({ adopters: 0, adoptionPercent: 0 });
  });

  it('400 on invalid body (snapshots not an array)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ snapshots: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a snapshot with an unknown module enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ snapshots: [wireSnapshot({ activeModules: ['not_a_module'] })] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/adoption/module-adoption')
      .set(uid)
      .send({ snapshots: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/adoption/module-adoption')
      .set(uid)
      .send({ snapshots: [] });
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. funnel
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/adoption/funnel', () => {
  const url = '/api/p1/adoption/funnel';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ snapshots: [] });
    expect(res.status).toBe(401);
  });

  it('200 computes the real funnel stages with percentOfPrevious / percentOfSignup', async () => {
    // 4 tenants:
    //  - first_project: activeProjects>=1 → t1,t2,t3 (3)
    //  - first_team:    activeWorkers>=3  → t1,t2 (2)
    //  - first_incident_logged: has 'incidents' → t1 (1)
    //  - first_document_uploaded: has 'documents' → 0
    //  - daily_active:  events30d>=30 → t1,t2 (2)
    const snapshots = [
      wireSnapshot({ tenantId: 't1', activeProjects: 2, activeWorkers: 5, events30d: 100, activeModules: ['incidents'] }),
      wireSnapshot({ tenantId: 't2', activeProjects: 1, activeWorkers: 3, events30d: 40, activeModules: ['projects'] }),
      wireSnapshot({ tenantId: 't3', activeProjects: 1, activeWorkers: 1, events30d: 10, activeModules: ['projects'] }),
      wireSnapshot({ tenantId: 't4', activeProjects: 0, activeWorkers: 0, events30d: 0, activeModules: [] }),
    ];
    const res = await request(buildApp()).post(url).set(uid).send({ snapshots });
    expect(res.status).toBe(200);
    const byStage = Object.fromEntries(
      (res.body.report.stages as Array<{ stage: string }>).map((s) => [s.stage, s]),
    );
    // signup = total (4); percentOfPrevious/percentOfSignup = 100.
    expect(byStage.signup).toEqual({ stage: 'signup', reached: 4, percentOfPrevious: 100, percentOfSignup: 100 });
    // first_project 3/4: prev=signup(4) → round(75)=75; ofSignup round(75)=75.
    expect(byStage.first_project).toEqual({ stage: 'first_project', reached: 3, percentOfPrevious: 75, percentOfSignup: 75 });
    // first_team 2/3 prev → round(66.66)=67; ofSignup 2/4 = 50.
    expect(byStage.first_team).toEqual({ stage: 'first_team', reached: 2, percentOfPrevious: 67, percentOfSignup: 50 });
    // first_incident_logged 1/2 prev = 50; ofSignup 1/4 = 25.
    expect(byStage.first_incident_logged).toEqual({ stage: 'first_incident_logged', reached: 1, percentOfPrevious: 50, percentOfSignup: 25 });
    // first_document_uploaded 0/1 prev = 0; ofSignup 0.
    expect(byStage.first_document_uploaded).toEqual({ stage: 'first_document_uploaded', reached: 0, percentOfPrevious: 0, percentOfSignup: 0 });
    // daily_active 2: prev=first_document(0) → 0 (divide-by-zero guard); ofSignup 2/4 = 50.
    expect(byStage.daily_active).toEqual({ stage: 'daily_active', reached: 2, percentOfPrevious: 0, percentOfSignup: 50 });
    // Stage order is fixed.
    expect((res.body.report.stages as Array<{ stage: string }>).map((s) => s.stage)).toEqual([
      'signup',
      'first_project',
      'first_team',
      'first_incident_logged',
      'first_document_uploaded',
      'daily_active',
    ]);
  });

  it('400 when snapshots is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/adoption/funnel')
      .set(uid)
      .send({ snapshots: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. churn-risk
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/adoption/churn-risk', () => {
  const url = '/api/p1/adoption/churn-risk';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ snapshot: wireSnapshot() });
    expect(res.status).toBe(401);
  });

  it('200 low risk for a healthy, paid, active tenant (score 0)', async () => {
    const snapshot = wireSnapshot({
      tenantId: 'healthy',
      events30d: 500,
      activeModules: ['projects', 'workers', 'incidents'],
      activeWorkers: 10,
      activeProjects: 4,
      hasPaidPlan: true,
      daysSinceSignup: 60,
    });
    const res = await request(buildApp()).post(url).set(uid).send({ snapshot });
    expect(res.status).toBe(200);
    expect(res.body.report.tenantId).toBe('healthy');
    expect(res.body.report.riskScore).toBe(0);
    expect(res.body.report.level).toBe('low');
    expect(res.body.report.signals).toEqual([]);
  });

  it('200 critical risk with the real additive scoring + signal list (score capped at 100)', async () => {
    // 0 events (+50, 0-eventos), <=1 module (+20), 0 workers (+15),
    // >30d & 0 projects (+25), trial & >14d (+10) = 120 → capped to 100 (critical).
    const snapshot = wireSnapshot({
      tenantId: 'dying',
      events30d: 0,
      activeModules: ['projects'], // size 1 → <= 1 triggers
      activeWorkers: 0,
      activeProjects: 0,
      hasPaidPlan: false,
      daysSinceSignup: 40,
    });
    const res = await request(buildApp()).post(url).set(uid).send({ snapshot });
    expect(res.status).toBe(200);
    expect(res.body.report.riskScore).toBe(100);
    expect(res.body.report.level).toBe('critical');
    expect(res.body.report.signals).toEqual([
      '0 eventos en 30 días',
      'Usa 1 o menos módulos',
      'Sin trabajadores activos',
      '30d+ sin crear primer proyecto',
      'Trial sin conversión a paid',
    ]);
  });

  it('200 medium risk reproduces the low-events (<5) branch (score 30 → medium)', async () => {
    // events30d=3 (+30) but otherwise healthy: 2 modules, workers, projects, paid.
    const snapshot = wireSnapshot({
      tenantId: 'quiet',
      events30d: 3,
      activeModules: ['projects', 'workers'],
      activeWorkers: 4,
      activeProjects: 2,
      hasPaidPlan: true,
      daysSinceSignup: 10,
    });
    const res = await request(buildApp()).post(url).set(uid).send({ snapshot });
    expect(res.status).toBe(200);
    expect(res.body.report.riskScore).toBe(30);
    expect(res.body.report.level).toBe('medium');
    expect(res.body.report.signals).toEqual(['Solo 3 eventos en 30d']);
  });

  it('400 when snapshot is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when daysSinceSignup is negative (schema nonnegative)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ snapshot: wireSnapshot({ daysSinceSignup: -1 }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/adoption/churn-risk')
      .set(uid)
      .send({ snapshot: wireSnapshot() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. first-value
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/adoption/first-value', () => {
  const url = '/api/p1/adoption/first-value';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ events: [] });
    expect(res.status).toBe(401);
  });

  it('200 computes reached count, average days, and stuck count from the real engine', async () => {
    // signup 2026-05-01. nowIso pinned so the stuck calc is deterministic.
    //  - a: reached after 2 days
    //  - b: reached after 4 days  → avg = (2+4)/2 = 3.0
    //  - c: not reached, signed up 2026-05-01, now=2026-05-20 (>7d) → stuck
    //  - d: not reached, signed up 2026-05-18, now=2026-05-20 (2d, <7d) → NOT stuck
    const events = [
      { tenantId: 'a', signupAt: '2026-05-01T00:00:00.000Z', firstValueAt: '2026-05-03T00:00:00.000Z' },
      { tenantId: 'b', signupAt: '2026-05-01T00:00:00.000Z', firstValueAt: '2026-05-05T00:00:00.000Z' },
      { tenantId: 'c', signupAt: '2026-05-01T00:00:00.000Z' },
      { tenantId: 'd', signupAt: '2026-05-18T00:00:00.000Z' },
    ];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ events, nowIso: '2026-05-20T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.report.total).toBe(4);
    expect(res.body.report.reachedFirstValue).toBe(2);
    expect(res.body.report.averageDaysToFirstValue).toBe(3);
    expect(res.body.report.stuckCount).toBe(1);
  });

  it('200 averageDays is 0 when nobody reached first value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        events: [{ tenantId: 'x', signupAt: '2026-05-01T00:00:00.000Z' }],
        nowIso: '2026-05-02T00:00:00.000Z',
      });
    expect(res.status).toBe(200);
    expect(res.body.report).toEqual({
      total: 1,
      reachedFirstValue: 0,
      averageDaysToFirstValue: 0,
      stuckCount: 0,
    });
  });

  it('400 when events is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ events: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/adoption/first-value')
      .set(uid)
      .send({ events: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// Type-only guard: keep the imported engine type referenced so the import is
// not pruned (the wire shape mirrors TenantUsageSnapshot minus the Set).
const _typeCheck: keyof TenantUsageSnapshot = 'activeModules';
void _typeCheck;
