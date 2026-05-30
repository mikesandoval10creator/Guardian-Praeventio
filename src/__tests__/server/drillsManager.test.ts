// Real-router supertest for src/server/routes/drillsManager.ts
// (Plan v3 Fase 1 — 4 Firestore-backed endpoints, 0 production code changed).
//
// Route is mounted at /api/sprint-k in server.ts.
// Endpoints:
//   GET  /:projectId/drills[?status=&kind=]        → 200 { drills }
//   GET  /:projectId/drills/:drillId               → 200 { drill } | 404
//   POST /:projectId/drills/plan                   → 201 { ok, drill }
//   POST /:projectId/drills/:drillId/execute       → 200 { ok, drill }
//
// Guard pattern identical to criticalControls.test.ts (proven Pattern v3).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── vi.hoisted holder so the db can be re-assigned in beforeEach ──────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin mock — must be before any import of the route ─────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── verifyAuth: pass-through when x-test-uid present, 401 when absent ────────
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

// ── validate middleware: use the real one so Zod 400 paths work ──────────────
// (no mock needed — it is a pure function over req.body, no external deps)

// ── logger + observability ────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ── evaluateDrillResult — use the real pure function (deterministic) ──────────
// Dynamic import inside route: '../../services/drillsManager/drillsManager.js'
// No mock needed — it is a pure calc with no side effects.

// ── Mount REAL router ─────────────────────────────────────────────────────────
import drillsManagerRouter from '../../server/routes/drillsManager.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', drillsManagerRouter);
  return app;
}

// ── Shared fixtures ───────────────────────────────────────────────────────────
const PROJECT_ID = 'proj-drills-test';
const TENANT_ID = 'tenant-drills-test';
const CALLER_UID = 'uid-drills-member';
const STRANGER_UID = 'uid-stranger';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    name: 'Proyecto Simulacros Test',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

function seedDrill(
  db: NonNullable<typeof H.db>,
  drillId: string,
  overrides: Record<string, unknown> = {},
) {
  db._seed(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/drills/${drillId}`, {
    id: drillId,
    kind: 'evacuation',
    scheduledAt: '2026-06-01T09:00:00.000Z',
    responsibleUid: CALLER_UID,
    status: 'planned',
    createdAt: '2026-05-01T08:00:00.000Z',
    createdBy: CALLER_UID,
    expectedCount: 50,
    benchmarkSeconds: 180,
    ...overrides,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:projectId/drills
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/drills', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/drills`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', STRANGER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 via guard when project does not exist', async () => {
    // project not seeded → assertProjectMember throws ProjectMembershipError → 403
    const res = await request(buildApp())
      .get(`/api/sprint-k/nonexistent-project/drills`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
  });

  it('200 returns empty drills array when none exist', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('drills');
    expect(Array.isArray(res.body.drills)).toBe(true);
    expect(res.body.drills).toHaveLength(0);
  });

  it('200 returns seeded drills ordered newest-first', async () => {
    seedDrill(H.db!, 'drill-1', { createdAt: '2026-05-01T08:00:00.000Z', kind: 'fire' });
    seedDrill(H.db!, 'drill-2', { createdAt: '2026-05-10T08:00:00.000Z', kind: 'evacuation' });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.drills).toHaveLength(2);
    // newest first: drill-2 created 10 May > drill-1 created 01 May
    expect(res.body.drills[0].id).toBe('drill-2');
    expect(res.body.drills[1].id).toBe('drill-1');
  });

  it('200 filters by status query param', async () => {
    seedDrill(H.db!, 'drill-planned', { status: 'planned' });
    seedDrill(H.db!, 'drill-completed', { status: 'completed' });
    const res = await request(buildApp())
      .get(`${url}?status=planned`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.drills).toHaveLength(1);
    expect(res.body.drills[0].id).toBe('drill-planned');
    expect(res.body.drills[0].status).toBe('planned');
  });

  it('200 ignores invalid status value and returns all drills', async () => {
    seedDrill(H.db!, 'drill-a', { status: 'planned' });
    const res = await request(buildApp())
      .get(`${url}?status=invalid-status`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    // invalid status → no filter applied → returns all
    expect(res.body.drills).toHaveLength(1);
  });

  it('200 filters by kind query param', async () => {
    seedDrill(H.db!, 'drill-fire', { kind: 'fire' });
    seedDrill(H.db!, 'drill-evac', { kind: 'evacuation' });
    const res = await request(buildApp())
      .get(`${url}?kind=fire`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.drills).toHaveLength(1);
    expect(res.body.drills[0].kind).toBe('fire');
  });

  it('200 drills include id field merged from doc.id', async () => {
    seedDrill(H.db!, 'drill-with-id');
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.drills[0].id).toBe('drill-with-id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:projectId/drills/:drillId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/drills/:drillId', () => {
  const DRILL_ID = 'drill-detail-test';
  const url = `/api/sprint-k/${PROJECT_ID}/drills/${DRILL_ID}`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', STRANGER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when drill document does not exist', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('drill_not_found');
  });

  it('200 returns drill detail with id merged', async () => {
    seedDrill(H.db!, DRILL_ID, { title: 'Simulacro evacuación faena norte' });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.drill).toBeDefined();
    expect(res.body.drill.id).toBe(DRILL_ID);
    expect(res.body.drill.kind).toBe('evacuation');
    expect(res.body.drill.status).toBe('planned');
    expect(res.body.drill.title).toBe('Simulacro evacuación faena norte');
    expect(res.body.drill.responsibleUid).toBe(CALLER_UID);
  });

  it('200 returns drill without optional fields when not set', async () => {
    seedDrill(H.db!, DRILL_ID);
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.drill.executedAt).toBeUndefined();
    expect(res.body.drill.report).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/drills/plan
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/drills/plan', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/drills/plan`;

  const minBody = {
    id: 'drill-plan-001',
    kind: 'fire',
    scheduledAt: '2026-07-15T09:00:00.000Z',
    responsibleUid: CALLER_UID,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(minBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', STRANGER_UID)
      .send(minBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 when required field id is missing', async () => {
    const { id: _id, ...bodyWithoutId } = minBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(bodyWithoutId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when kind is not a valid DrillKind enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBody, kind: 'invalid-kind' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when id is empty string', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBody, id: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when scheduledAt is too short', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBody, scheduledAt: '2026' }); // less than 10 chars
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when expectedCount is negative', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBody, expectedCount: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when benchmarkSeconds is zero (must be positive)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBody, benchmarkSeconds: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('201 happy path with minimal fields', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.drill).toBeDefined();
    expect(res.body.drill.id).toBe(minBody.id);
    expect(res.body.drill.kind).toBe('fire');
    expect(res.body.drill.status).toBe('planned');
    expect(res.body.drill.createdBy).toBe(CALLER_UID);
    expect(typeof res.body.drill.createdAt).toBe('string');
  });

  it('201 happy path with all optional fields', async () => {
    const fullBody = {
      ...minBody,
      id: 'drill-plan-full',
      title: 'Simulacro incendio bodega norte',
      location: 'Bodega Norte — piso 2',
      expectedCount: 45,
      benchmarkSeconds: 240,
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(fullBody);
    expect(res.status).toBe(201);
    expect(res.body.drill.title).toBe('Simulacro incendio bodega norte');
    expect(res.body.drill.location).toBe('Bodega Norte — piso 2');
    expect(res.body.drill.expectedCount).toBe(45);
    expect(res.body.drill.benchmarkSeconds).toBe(240);
  });

  it('201 persists drill to Firestore (read back from fakeFirestore)', async () => {
    const drillId = 'drill-persisted-check';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBody, id: drillId, kind: 'earthquake' });
    expect(res.status).toBe(201);

    // Verify Firestore side-effect
    const stored = H.db!._dump();
    const drillPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/drills/${drillId}`;
    expect(stored[drillPath]).toBeDefined();
    expect(stored[drillPath].kind).toBe('earthquake');
    expect(stored[drillPath].status).toBe('planned');
    expect(stored[drillPath].createdBy).toBe(CALLER_UID);
  });

  it('201 all DrillKind values are accepted', async () => {
    const kinds = [
      'evacuation', 'fire', 'spill_chemical', 'first_aid',
      'rescue_confined', 'rescue_height', 'gas_leak', 'earthquake',
    ] as const;
    for (const kind of kinds) {
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ ...minBody, id: `drill-kind-${kind}`, kind });
      expect(res.status).toBe(201);
      expect(res.body.drill.kind).toBe(kind);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/drills/:drillId/execute
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/drills/:drillId/execute', () => {
  const DRILL_ID = 'drill-execute-test';
  const url = `/api/sprint-k/${PROJECT_ID}/drills/${DRILL_ID}/execute`;

  const minExecuteBody = {
    executedAt: '2026-06-01T10:30:00.000Z',
    participantCount: 45,
    responseTimeSeconds: 150,
  };

  beforeEach(() => {
    // Seed a planned drill ready to be executed
    seedDrill(H.db!, DRILL_ID, {
      status: 'planned',
      kind: 'evacuation',
      expectedCount: 50,
      benchmarkSeconds: 180,
    });
  });

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(minExecuteBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', STRANGER_UID)
      .send(minExecuteBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 when executedAt is missing', async () => {
    const { executedAt: _ea, ...bodyWithout } = minExecuteBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(bodyWithout);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when participantCount is missing', async () => {
    const { participantCount: _pc, ...bodyWithout } = minExecuteBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(bodyWithout);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when participantCount is negative', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minExecuteBody, participantCount: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when responseTimeSeconds is missing', async () => {
    const { responseTimeSeconds: _rt, ...bodyWithout } = minExecuteBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(bodyWithout);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when observedGaps item exceeds 500 chars', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minExecuteBody, observedGaps: ['x'.repeat(501)] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when notes exceeds 4000 chars', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minExecuteBody, notes: 'n'.repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('404 when drill document does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/drills/nonexistent-drill/execute`)
      .set('x-test-uid', CALLER_UID)
      .send(minExecuteBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('drill_not_found');
  });

  it('200 happy path — status transitions to completed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minExecuteBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.drill).toBeDefined();
    expect(res.body.drill.status).toBe('completed');
    expect(res.body.drill.executedAt).toBe('2026-06-01T10:30:00.000Z');
    expect(res.body.drill.participantCount).toBe(45);
    expect(res.body.drill.responseTimeSeconds).toBe(150);
  });

  it('200 report is computed and embedded in response', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minExecuteBody, participantCount: 45, expectedCount: 50, responseTimeSeconds: 150, benchmarkSeconds: 180 });
    expect(res.status).toBe(200);
    const { report } = res.body.drill;
    expect(report).toBeDefined();
    expect(typeof report.participationRate).toBe('number');
    expect(typeof report.speedDeficitPercent).toBe('number');
    expect(typeof report.level).toBe('string');
    expect(Array.isArray(report.recommendations)).toBe(true);
    // 45/50 = 90% participation, 150/180 = -17% speed deficit → excellent
    expect(report.level).toBe('excellent');
    expect(report.participationRate).toBe(90);
  });

  it('200 report level is good when participation 80-89% and speed deficit ≤40%', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minExecuteBody,
        participantCount: 40, // 40/50 = 80%
        expectedCount: 50,
        responseTimeSeconds: 200, // 200/180 = +11% deficit
        benchmarkSeconds: 180,
      });
    expect(res.status).toBe(200);
    expect(res.body.drill.report.level).toBe('good');
    expect(res.body.drill.report.participationRate).toBe(80);
  });

  it('200 report level is critical when participation < 60%', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minExecuteBody,
        participantCount: 20, // 20/50 = 40%
        expectedCount: 50,
        responseTimeSeconds: 500, // far over benchmark
        benchmarkSeconds: 180,
      });
    expect(res.status).toBe(200);
    expect(res.body.drill.report.level).toBe('critical');
  });

  it('200 report level is insufficient_baseline when expectedCount missing from both plan and execute', async () => {
    // Seed a drill WITHOUT expectedCount or benchmarkSeconds
    const drillId = 'drill-no-baseline';
    seedDrill(H.db!, drillId, { status: 'planned', kind: 'fire' });
    // Remove baseline fields from seeded doc
    H.db!._seed(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/drills/${drillId}`, {
      id: drillId,
      kind: 'fire',
      scheduledAt: '2026-06-01T09:00:00.000Z',
      responsibleUid: CALLER_UID,
      status: 'planned',
      createdAt: '2026-05-01T08:00:00.000Z',
      createdBy: CALLER_UID,
      // no expectedCount, no benchmarkSeconds
    });
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/drills/${drillId}/execute`)
      .set('x-test-uid', CALLER_UID)
      .send({
        executedAt: '2026-06-01T10:30:00.000Z',
        participantCount: 30,
        responseTimeSeconds: 200,
        // no expectedCount, no benchmarkSeconds
      });
    expect(res.status).toBe(200);
    expect(res.body.drill.report.level).toBe('insufficient_baseline');
    expect(res.body.drill.report.participationRate).toBeNull();
    expect(res.body.drill.report.speedDeficitPercent).toBeNull();
  });

  it('200 execute body can override expectedCount and benchmarkSeconds from plan', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minExecuteBody,
        participantCount: 46,
        expectedCount: 46, // override plan's 50
        responseTimeSeconds: 170,
        benchmarkSeconds: 200, // override plan's 180
      });
    expect(res.status).toBe(200);
    expect(res.body.drill.expectedCount).toBe(46);
    expect(res.body.drill.benchmarkSeconds).toBe(200);
    // 46/46 = 100%, 170/200 = -15% → excellent
    expect(res.body.drill.report.level).toBe('excellent');
    expect(res.body.drill.report.participationRate).toBe(100);
  });

  it('200 observedGaps from execute body are stored and surface in recommendations', async () => {
    const gaps = ['Señalización de salida bloqueada', 'Extintores sin revisar'];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minExecuteBody,
        participantCount: 50,
        expectedCount: 50,
        responseTimeSeconds: 180,
        benchmarkSeconds: 180,
        observedGaps: gaps,
      });
    expect(res.status).toBe(200);
    expect(res.body.drill.observedGaps).toEqual(gaps);
    // gaps.length = 2 → no longer "excellent" (requires 0 gaps for excellent)
    expect(['good', 'needs_improvement', 'critical']).toContain(res.body.drill.report.level);
    // recommendations should mention gaps
    const recs: string[] = res.body.drill.report.recommendations;
    expect(recs.some((r) => r.includes('brechas'))).toBe(true);
  });

  it('200 requiredExternal=true surfaces in recommendations', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minExecuteBody,
        participantCount: 45,
        expectedCount: 50,
        responseTimeSeconds: 150,
        benchmarkSeconds: 180,
        requiredExternal: true,
      });
    expect(res.status).toBe(200);
    const recs: string[] = res.body.drill.report.recommendations;
    expect(recs.some((r) => r.includes('externa'))).toBe(true);
  });

  it('200 Firestore side-effect: status updated to completed in store', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minExecuteBody);
    expect(res.status).toBe(200);

    const drillPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/drills/${DRILL_ID}`;
    const stored = H.db!._dump();
    expect(stored[drillPath]).toBeDefined();
    expect(stored[drillPath].status).toBe('completed');
    expect(stored[drillPath].executedAt).toBe('2026-06-01T10:30:00.000Z');
    expect(stored[drillPath].participantCount).toBe(45);
    expect(stored[drillPath].report).toBeDefined();
  });

  it('200 notes are stored when provided', async () => {
    const notes = 'Simulacro realizado con éxito. Personal bien preparado.';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minExecuteBody, notes });
    expect(res.status).toBe(200);
    expect(res.body.drill.notes).toBe(notes);
    const drillPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/drills/${DRILL_ID}`;
    expect(H.db!._dump()[drillPath].notes).toBe(notes);
  });

  it('200 merged drill response includes all original plan fields', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minExecuteBody);
    expect(res.status).toBe(200);
    const { drill } = res.body;
    // Fields from the original plan must still be present in the merged doc
    expect(drill.kind).toBe('evacuation');
    expect(drill.scheduledAt).toBe('2026-06-01T09:00:00.000Z');
    expect(drill.responsibleUid).toBe(CALLER_UID);
    expect(drill.createdBy).toBe(CALLER_UID);
  });
});
