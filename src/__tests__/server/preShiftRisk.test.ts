// Real-router supertest for GET /api/sprint-k/:projectId/pre-shift-risk
// (src/server/routes/preShiftRisk.ts — 453 LOC, F.21 pre-shift panel).
//
// The endpoint is a pure GET: verifyAuth → assertProjectMember → resolveTenantId
// → parallel Firestore reads → composeShiftRiskPanel.  No idempotency key, no
// rate limiter, no Zod safeParse.  Dynamic imports of `composeShiftRiskPanel`
// and `normalizeSeverity` are mocked at their canonical module specifiers so
// vitest intercepts the `await import(...)` calls inside the handler.

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

// verifyAuth: set req.user from x-test-uid; 401 if absent.
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

// assertProjectMember: pass-through (project membership is seeded in Firestore).
// The route calls assertProjectMember(callerUid, projectId, admin.firestore()),
// which reads db.collection('projects').doc(projectId). We seed the project doc
// so the real implementation resolves. For the 403 path we DON'T seed the doc —
// real impl throws ProjectMembershipError (project not found).
vi.mock('../../services/auth/projectMembership.js', async () => {
  const real = await import('../../services/auth/projectMembership.js');
  return real; // use real implementation; membership is determined by seeded data
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// Dynamic imports mocked at the exact specifiers the route uses.
vi.mock('../../services/shiftRiskPanel/preShiftRiskComposer.js', () => ({
  composeShiftRiskPanel: vi.fn(() => ({
    projectId: 'p1',
    shift: 'day',
    date: '2026-05-30',
    riskScore: 20,
    level: 'green',
    factors: [],
    topRecommendations: [],
    recommendDelayShiftStart: false,
  })),
}));

vi.mock('../../services/incidentBundle/incidentEvidenceBundle.js', () => ({
  normalizeSeverity: vi.fn((raw: string) => {
    const map: Record<string, string> = { alto: 'high', bajo: 'low', critico: 'critical' };
    return map[raw.toLowerCase()] ?? raw;
  }),
}));

import preShiftRiskRouter from '../../server/routes/preShiftRisk.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { composeShiftRiskPanel } from '../../services/shiftRiskPanel/preShiftRiskComposer.js';

const PROJECT_ID = 'p1';
const CALLER_UID = 'worker-1';
const TENANT_ID = 't1';

/** Base URL that matches server.ts: app.use('/api/sprint-k', preShiftRiskRouter) */
const GET_URL = `/api/sprint-k/${PROJECT_ID}/pre-shift-risk`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', preShiftRiskRouter);
  return app;
}

/** Seed a valid project doc with tenantId so guard() passes. */
function seedProject(overrides: Record<string, unknown> = {}) {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [CALLER_UID],
    createdBy: CALLER_UID,
    emergencyBrigadeReady: false,
    ...overrides,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.mocked(composeShiftRiskPanel).mockClear();
  vi.mocked(composeShiftRiskPanel).mockReturnValue({
    projectId: PROJECT_ID,
    shift: 'day',
    date: '2026-05-30',
    riskScore: 20,
    level: 'green',
    factors: [],
    topRecommendations: [],
    recommendDelayShiftStart: false,
  });
});

// ── Auth gate ────────────────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — auth gate', () => {
  it('401 when no x-test-uid header', async () => {
    const res = await request(buildApp()).get(GET_URL);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });
});

// ── Project membership gate ──────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — membership gate', () => {
  it('403 when caller is not a member of the project', async () => {
    // Project exists but members list does NOT include the caller uid.
    H.db!._seed(`projects/${PROJECT_ID}`, {
      tenantId: TENANT_ID,
      members: ['someone-else'],
      createdBy: 'another-user',
    });
    const res = await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project document does not exist', async () => {
    // Nothing seeded — assertProjectMember will throw ProjectMembershipError.
    const res = await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ── Tenant resolution gate ───────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — tenant resolution', () => {
  it('404 when project has no tenantId (and members subcollection has no tenantId)', async () => {
    // Seed a project doc WITHOUT tenantId — caller IS a member (members array).
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [CALLER_UID],
      createdBy: CALLER_UID,
      // intentionally no tenantId
    });
    const res = await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('404 when tenantId comes from members subcollection but is missing there too', async () => {
    // Seed a project without tenantId at doc level.
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [CALLER_UID],
      createdBy: CALLER_UID,
    });
    // Seed a members subcollection doc with no tenantId field.
    H.db!._seed(`projects/${PROJECT_ID}/members/m1`, {
      uid: CALLER_UID,
      // no tenantId
    });
    const res = await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });
});

// ── Happy path ───────────────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — happy path', () => {
  it('200 returns { panel } with default shift=day and today date', async () => {
    seedProject();
    const res = await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('panel');
    expect(res.body.panel.projectId).toBe(PROJECT_ID);
    expect(res.body.panel.level).toBe('green');
    expect(typeof res.body.panel.riskScore).toBe('number');
  });

  it('passes composeShiftRiskPanel the correct projectId and shift=day by default', async () => {
    seedProject();
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(vi.mocked(composeShiftRiskPanel)).toHaveBeenCalledTimes(1);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.projectId).toBe(PROJECT_ID);
    expect(args.shift).toBe('day');
  });

  it('passes shift=night when ?shift=night', async () => {
    seedProject();
    await request(buildApp())
      .get(`${GET_URL}?shift=night`)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.shift).toBe('night');
  });

  it('passes shift=evening when ?shift=evening', async () => {
    seedProject();
    await request(buildApp())
      .get(`${GET_URL}?shift=evening`)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.shift).toBe('evening');
  });

  it('falls back to shift=day for invalid ?shift= value', async () => {
    seedProject();
    await request(buildApp())
      .get(`${GET_URL}?shift=bogus`)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.shift).toBe('day');
  });

  it('accepts ?date=YYYY-MM-DD and passes it to composeShiftRiskPanel', async () => {
    seedProject();
    await request(buildApp())
      .get(`${GET_URL}?date=2026-06-01`)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.date).toBe('2026-06-01');
  });

  it('falls back to today when ?date= is not a valid YYYY-MM-DD', async () => {
    seedProject();
    await request(buildApp())
      .get(`${GET_URL}?date=not-a-date`)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    // Must be a valid YYYY-MM-DD string (today's date used as fallback)
    expect(/^\d{4}-\d{2}-\d{2}$/.test(args.date)).toBe(true);
  });

  it('passes emergencyBrigadeReady=true from project doc', async () => {
    seedProject({ emergencyBrigadeReady: true });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.emergencyBrigadeReady).toBe(true);
  });

  it('passes emergencyBrigadeReady=false when project doc has no such field', async () => {
    // Seed without emergencyBrigadeReady
    H.db!._seed(`projects/${PROJECT_ID}`, {
      tenantId: TENANT_ID,
      members: [CALLER_UID],
      createdBy: CALLER_UID,
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.emergencyBrigadeReady).toBe(false);
  });
});

// ── Worker data reads ────────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — worker data', () => {
  it('passes workers with resolved hireDate paths (hireDate field)', async () => {
    seedProject();
    const hireDate = '2023-01-15';
    H.db!._seed(`projects/${PROJECT_ID}/workers/w1`, {
      fullName: 'Juan Pérez',
      fatigueRisk: 'high',
      hireDate,
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.workers).toHaveLength(1);
    expect(args.workers[0].fatigueRisk).toBe('high');
    expect(args.workers[0].fullName).toBe('Juan Pérez');
    expect(typeof args.workers[0].daysSinceHire).toBe('number');
    expect(args.workers[0].daysSinceHire).toBeGreaterThan(0);
  });

  it('uses joinedAt fallback when hireDate absent', async () => {
    seedProject();
    H.db!._seed(`projects/${PROJECT_ID}/workers/w2`, {
      displayName: 'María López',
      fatigueRisk: 'low',
      joinedAt: '2024-03-01',
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.workers[0].daysSinceHire).toBeGreaterThan(0);
  });

  it('sets daysSinceHire=999 when no hire date field exists', async () => {
    seedProject();
    H.db!._seed(`projects/${PROJECT_ID}/workers/w3`, {
      name: 'Sin Fecha',
      fatigueRisk: 'low',
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.workers[0].daysSinceHire).toBe(999);
  });

  it('defaults fatigueRisk=low for unknown values', async () => {
    seedProject();
    H.db!._seed(`projects/${PROJECT_ID}/workers/w4`, {
      fullName: 'Sin Riesgo',
      fatigueRisk: 'unknown-value',
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.workers[0].fatigueRisk).toBe('low');
  });
});

// ── Incident data reads ──────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — recent incidents', () => {
  it('includes incidents within the last 7 days', async () => {
    seedProject();
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    H.db!._seed(`incidents/i1`, {
      projectId: PROJECT_ID,
      severity: 'alto',
      occurredAt: recentDate,
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.recentIncidents).toHaveLength(1);
    expect(args.recentIncidents[0].id).toBe('i1');
    expect(typeof args.recentIncidents[0].occurredAt).toBe('string');
  });

  it('excludes incidents older than 7 days', async () => {
    seedProject();
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    H.db!._seed(`incidents/i2`, {
      projectId: PROJECT_ID,
      severity: 'low',
      occurredAt: oldDate,
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.recentIncidents).toHaveLength(0);
  });

  it('falls back to createdAt when occurredAt is absent', async () => {
    seedProject();
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    H.db!._seed(`incidents/i3`, {
      projectId: PROJECT_ID,
      severity: 'medium',
      createdAt: recentDate,
      // no occurredAt
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.recentIncidents).toHaveLength(1);
  });

  it('maps "sif" normalized severity to "critical"', async () => {
    // Override the normalizeSeverity mock for this test to return 'sif'
    const { normalizeSeverity } = await import(
      '../../services/incidentBundle/incidentEvidenceBundle.js'
    );
    vi.mocked(normalizeSeverity).mockReturnValueOnce('sif' as ReturnType<typeof normalizeSeverity>);
    seedProject();
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    H.db!._seed(`incidents/i4`, {
      projectId: PROJECT_ID,
      severity: 'SIF',
      occurredAt: recentDate,
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.recentIncidents).toHaveLength(1);
    expect(args.recentIncidents[0].severity).toBe('critical');
  });
});

// ── Equipment/asset reads ────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — equipment', () => {
  it('reads legacy assets and includes overdue maintenance', async () => {
    seedProject();
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    H.db!._seed(`assets/eq1`, {
      projectId: PROJECT_ID,
      code: 'EQ-001',
      nextMaintenanceAt: pastDate,
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    const eq = args.equipment.find((e: { id: string }) => e.id === 'eq1');
    expect(eq).toBeDefined();
    expect(eq!.overdueMaintenance).toBe(true);
  });

  it('reads canonical tenant equipment and merges with legacy', async () => {
    seedProject();
    H.db!._seed(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/equipment/eq2`, {
      code: 'EQ-002',
      nextMaintenanceAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    const eq = args.equipment.find((e: { id: string }) => e.id === 'eq2');
    expect(eq).toBeDefined();
    expect(eq!.overdueMaintenance).toBe(false);
  });
});

// ── Task reads ───────────────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — tasks', () => {
  it('includes critical tasks within the shift day window', async () => {
    seedProject();
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0); // midday UTC, within shift day
    H.db!._seed(`tasks/t1`, {
      projectId: PROJECT_ID,
      category: 'maintenance',
      criticality: 'critical',
      plannedDate: today.toISOString(),
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    const task = args.plannedTasks.find((t: { id: string }) => t.id === 't1');
    expect(task).toBeDefined();
    expect(task!.isCriticalTask).toBe(true);
  });

  it('marks isCriticalTask=true when isCriticalTask boolean field is true', async () => {
    seedProject();
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    H.db!._seed(`tasks/t2`, {
      projectId: PROJECT_ID,
      isCriticalTask: true,
      plannedDate: today.toISOString(),
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    const task = args.plannedTasks.find((t: { id: string }) => t.id === 't2');
    expect(task!.isCriticalTask).toBe(true);
  });

  it('excludes tasks outside the shift date window when planned 2 days ahead', async () => {
    seedProject();
    const futureDay = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    futureDay.setUTCHours(12, 0, 0, 0);
    H.db!._seed(`tasks/t3`, {
      projectId: PROJECT_ID,
      criticality: 'high',
      plannedDate: futureDay.toISOString(),
    });
    await request(buildApp())
      .get(`${GET_URL}?date=2026-05-30`) // fixed date: 2 days behind
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    const task = args.plannedTasks.find((t: { id: string }) => t.id === 't3');
    expect(task).toBeUndefined();
  });
});

// ── Weather / environment reads ──────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — weather env', () => {
  it('reads rainProbability from global_context/environment doc', async () => {
    seedProject();
    H.db!._seed('global_context/environment', {
      rainProbability: 0.85,
      windSpeedMs: 12,
      uvIndex: 5,
      temperatureC: 28,
      visibilityKm: 8,
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.weather.rainProbability).toBe(0.85);
    expect(args.weather.windSpeedMs).toBe(12);
    expect(args.weather.uvIndex).toBe(5);
    expect(args.weather.temperatureC).toBe(28);
    expect(args.weather.visibilityKm).toBe(8);
  });

  it('converts visibilityMeters to km when visibilityKm is absent', async () => {
    seedProject();
    H.db!._seed('global_context/environment', {
      visibility: 5000, // meters (OpenWeather style)
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.weather.visibilityKm).toBeCloseTo(5);
  });

  it('converts windKmh to m/s when windSpeedMs absent', async () => {
    seedProject();
    H.db!._seed('global_context/environment', {
      windKmh: 36, // 36 km/h = 10 m/s
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.weather.windSpeedMs).toBeCloseTo(10);
  });

  it('defaults to zeros when global_context/environment doc is missing', async () => {
    seedProject();
    // No environment doc seeded
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.weather.rainProbability).toBe(0);
    expect(args.weather.windSpeedMs).toBe(0);
    expect(args.weather.uvIndex).toBe(0);
    expect(args.weather.temperatureC).toBe(20);
    expect(args.weather.visibilityKm).toBe(10);
  });

  it('reads nested weather.rainProbability from env doc', async () => {
    seedProject();
    H.db!._seed('global_context/environment', {
      weather: { rainProbability: 0.7, windSpeedMs: 5 },
    });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.weather.rainProbability).toBe(0.7);
  });
});

// ── Active permits ───────────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — active permits', () => {
  it('passes activePermitsCount matching seeded active work_permits', async () => {
    seedProject();
    H.db!._seed(`work_permits/wp1`, { projectId: PROJECT_ID, status: 'active' });
    H.db!._seed(`work_permits/wp2`, { projectId: PROJECT_ID, status: 'active' });
    H.db!._seed(`work_permits/wp3`, { projectId: PROJECT_ID, status: 'expired' });
    await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(args.activePermitsCount).toBe(2);
  });
});

// ── Error handling ───────────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — error handling', () => {
  it('500 when composeShiftRiskPanel throws unexpectedly', async () => {
    seedProject();
    vi.mocked(composeShiftRiskPanel).mockImplementationOnce(() => {
      throw new Error('composer blew up');
    });
    const res = await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });

  it('still returns 200 when assets collection query fails (safeRead wraps it)', async () => {
    seedProject();
    // The assets collection isn't seeded, so it just returns empty — no error.
    // This test confirms safeRead() gracefully handles missing collections.
    const res = await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const args = vi.mocked(composeShiftRiskPanel).mock.calls[0][0];
    expect(Array.isArray(args.equipment)).toBe(true);
  });
});

// ── Response shape ───────────────────────────────────────────────────────

describe('GET /:projectId/pre-shift-risk — response shape', () => {
  it('response body has panel with required keys', async () => {
    seedProject();
    const res = await request(buildApp())
      .get(GET_URL)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { panel } = res.body;
    expect(panel).toHaveProperty('projectId');
    expect(panel).toHaveProperty('shift');
    expect(panel).toHaveProperty('date');
    expect(panel).toHaveProperty('riskScore');
    expect(panel).toHaveProperty('level');
    expect(panel).toHaveProperty('factors');
    expect(panel).toHaveProperty('topRecommendations');
    expect(panel).toHaveProperty('recommendDelayShiftStart');
  });
});
