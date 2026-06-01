// Real-router supertest for src/server/routes/workPermits.ts
// (Plan v3 Fase 1 — real-router server lever).
//
// Mounts the ACTUAL workPermits router at /api/sprint-k (same prefix as
// server.ts) through fakeFirestore so the full handler stack — verifyAuth,
// validate(zod), guard → assertProjectMember + resolveTenantId,
// resolveCallerRoleContext, adapter CRUD, engine functions — runs in the
// same in-process test. No parallel-copy stubs.
//
// Endpoints covered:
//   GET  /:projectId/work-permits             (list — 401 / 403 / 200 branches)
//   POST /:projectId/work-permits             (create — 401 / 400 / 403 / 409 / 201)
//   POST /:projectId/work-permits/validate-critical (advisory — 401/403/400/200)
//   POST /:projectId/work-permits/:permitId/sign   (sign — 401/403/404/400/200)
//   POST /:projectId/work-permits/:permitId/close  (close — 401/404/422/200)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── hoisted holder (db lives here so vi.mock closure can read it lazily) ──

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // Caller identity shim — individual tests can override this per-request
  // via the x-test-uid / x-test-role / x-test-admin headers instead of
  // re-building the app each time.
  callerRole: null as string | null,
  callerAdmin: false,
}));

// ── firebase-admin mock — thin shim over fakeFirestore ──

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── verifyAuth — stamps user from x-test-* headers ──
// x-test-uid   : required (omit → 401)
// x-test-role  : sets user.role claim
// x-test-admin : sets user.admin = true
// x-test-roles : comma-separated list → user.roles[]

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const role = req.header('x-test-role') ?? undefined;
    const rolesHdr = req.header('x-test-roles');
    const roles = rolesHdr ? rolesHdr.split(',').map((r) => r.trim()) : [];
    const admin = req.header('x-test-admin') === 'true';
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role,
      roles,
      admin,
    };
    next();
  },
}));

// ── projectMembership — the `guard` helper calls assertProjectMember ──
// We mock it so it accepts any project that exists in fakeFirestore as
// 'projects/{id}' and throws for unknown ones (403).

vi.mock('../../services/auth/projectMembership.js', async () => {
  // Import the real error class so instanceof checks in the route work.
  class ProjectMembershipError extends Error {
    httpStatus: number;
    constructor(message: string, httpStatus = 403) {
      super(message);
      this.name = 'ProjectMembershipError';
      this.httpStatus = httpStatus;
    }
  }
  return {
    ProjectMembershipError,
    assertProjectMember: async (
      _uid: string,
      projectId: string,
      db: { collection(p: string): { doc(id: string): { get(): Promise<{ exists: boolean }> } } },
    ) => {
      const snap = await db.collection('projects').doc(projectId).get();
      if (!snap.exists) throw new ProjectMembershipError('project not found', 403);
    },
  };
});

// ── WorkPermitAdapter + engine — NOT mocked; we use the real impls ──
// The fakeFirestore exposes the same query surface the adapter needs.

// ── criticalPermitValidators — use real impl (pure function, no deps) ──

// ── limiters / logger / observability ──

vi.mock('../../server/middleware/limiters.js', () => ({
  // workPermits route doesn't reference limiters but captureRouteError does.
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ── imports (must come AFTER vi.mock calls) ──

import workPermitsRouter from '../../server/routes/workPermits.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── App factory ──

function buildApp() {
  const app = express();
  app.use(express.json());
  // Same prefix as server.ts: app.use('/api/sprint-k', workPermitsRouter)
  app.use('/api/sprint-k', workPermitsRouter);
  return app;
}

// ── Seed helpers ──

function seedProject(db: NonNullable<typeof H.db>, pid = 'p1', tid = 't1') {
  db._seed(`projects/${pid}`, { tenantId: tid, name: 'Test Project' });
}

/** Seed a `pending_approval` work permit directly into fakeFirestore. */
function seedPermit(
  db: NonNullable<typeof H.db>,
  permitId: string,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date();
  const validUntil = new Date(now.getTime() + 4 * 3_600_000).toISOString();
  db._seed(`tenants/t1/projects/p1/work_permits/${permitId}`, {
    id: permitId,
    kind: 'altura',
    workerUid: 'worker-uid',
    approverUid: 'sup-uid',
    approverRole: 'supervisor',
    zoneId: null,
    taskDescription: 'Instalar panel solar en cubierta',
    status: 'pending_approval',
    preconditions: {
      workerHasTraining: false,
      workerHasEpp: false,
      workerMedicallyFit: false,
      checklist: {
        items: [
          { id: 'altura-check-0', label: 'Verificar arnés y línea de vida', checked: false },
          { id: 'altura-check-1', label: 'Verificar superficie de apoyo / barandas', checked: false },
          { id: 'altura-check-2', label: 'Verificar condiciones climáticas (viento ≤ 60 km/h)', checked: false },
          { id: 'altura-check-3', label: 'Verificar plan rescate', checked: false },
        ],
      },
    },
    createdAt: now.toISOString(),
    approvedAt: null,
    validFrom: now.toISOString(),
    validUntil,
    cancelledAt: null,
    cancelledReason: null,
    fulfilledAt: null,
    ...overrides,
  });
}

/** Seed an ACTIVE permit (status=active, validUntil in the future). */
function seedActivePermit(
  db: NonNullable<typeof H.db>,
  permitId: string,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date();
  const validUntil = new Date(now.getTime() + 4 * 3_600_000).toISOString();
  seedPermit(db, permitId, {
    status: 'active',
    approvedAt: now.toISOString(),
    preconditions: {
      workerHasTraining: true,
      workerHasEpp: true,
      workerMedicallyFit: true,
      checklist: {
        items: [
          { id: 'altura-check-0', label: 'Verificar arnés y línea de vida', checked: true, verifiedAt: now.toISOString() },
          { id: 'altura-check-1', label: 'Verificar superficie de apoyo / barandas', checked: true, verifiedAt: now.toISOString() },
          { id: 'altura-check-2', label: 'Verificar condiciones climáticas (viento ≤ 60 km/h)', checked: true, verifiedAt: now.toISOString() },
          { id: 'altura-check-3', label: 'Verificar plan rescate', checked: true, verifiedAt: now.toISOString() },
        ],
      },
    },
    validUntil,
    ...overrides,
  });
}

// ── Shared body for a valid create request ──

const VALID_CREATE_BODY = {
  id: 'wp-test-1',
  kind: 'altura',
  taskDescription: 'Instalación de paneles fotovoltaicos en techo',
  durationHours: 4,
};

// ──────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ══════════════════════════════════════════════════════════════════════════
// GET /:projectId/work-permits
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/sprint-k/:projectId/work-permits', () => {
  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp()).get('/api/sprint-k/p1/work-permits');
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member of the project (project not in fakeFirestore)', async () => {
    const res = await request(buildApp())
      .get('/api/sprint-k/unknown-project/work-permits')
      .set('x-test-uid', 'worker-1')
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('404 when project exists but has no tenantId (tenant_not_found)', async () => {
    H.db!._seed('projects/no-tenant', { name: 'No Tenant Project' }); // no tenantId field
    const res = await request(buildApp())
      .get('/api/sprint-k/no-tenant/work-permits')
      .set('x-test-uid', 'worker-1')
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_not_found');
  });

  it('200 returns empty permits array when no permits exist', async () => {
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'worker-1')
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as Record<string, unknown>).permits)).toBe(true);
    expect((res.body as { permits: unknown[] }).permits).toHaveLength(0);
  });

  it('200 with ?status=all — returns active permits via listActive', async () => {
    seedActivePermit(H.db!, 'wp-active-1');
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/work-permits?status=all')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(200);
    // The wantsAll branch calls listActive — active permit appears
    expect((res.body as { permits: unknown[] }).permits.length).toBeGreaterThan(0);
  });

  it('200 with ?kind=altura — returns active permits of that kind', async () => {
    seedActivePermit(H.db!, 'wp-altura-active');
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/work-permits?kind=altura')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(200);
    const body = res.body as { permits: Array<Record<string, unknown>> };
    expect(Array.isArray(body.permits)).toBe(true);
  });

  it('200 with ?kind=altura&status=pending_approval returns pending permits', async () => {
    seedPermit(H.db!, 'wp-pending');
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/work-permits?kind=altura&status=pending_approval')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(200);
    const body = res.body as { permits: Array<Record<string, unknown>> };
    // At least 1 pending permit exists
    expect(body.permits.length).toBeGreaterThanOrEqual(1);
    expect(body.permits[0].kind).toBe('altura');
  });

  it('200 with ?status=pending_approval (no kind) returns all pending permits', async () => {
    seedPermit(H.db!, 'wp-p1');
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/work-permits?status=pending_approval')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(200);
    const body = res.body as { permits: unknown[] };
    expect(body.permits.length).toBeGreaterThanOrEqual(1);
  });

  it('200 with ?kind=caliente&status=all uses listByKind', async () => {
    // caliente permit seeded manually
    H.db!._seed('tenants/t1/projects/p1/work_permits/wp-caliente', {
      id: 'wp-caliente',
      kind: 'caliente',
      workerUid: 'w1',
      approverUid: 'sup-1',
      approverRole: 'supervisor',
      zoneId: null,
      taskDescription: 'Soldadura estructura',
      status: 'pending_approval',
      preconditions: { workerHasTraining: false, workerHasEpp: false, workerMedicallyFit: false, checklist: { items: [] } },
      createdAt: new Date().toISOString(),
      approvedAt: null,
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      cancelledAt: null,
      cancelledReason: null,
      fulfilledAt: null,
    });
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/work-permits?kind=caliente&status=all')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor');
    expect(res.status).toBe(200);
    const body = res.body as { permits: Array<Record<string, unknown>> };
    expect(body.permits.some((p) => p.kind === 'caliente')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /:projectId/work-permits (create)
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/work-permits', () => {
  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(401);
  });

  it('400 when Zod validation fails (missing taskDescription)', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ id: 'wp-x', kind: 'altura', durationHours: 4 }); // no taskDescription
    expect(res.status).toBe(400);
  });

  it('400 when taskDescription is too short (< 3 chars)', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ id: 'wp-x', kind: 'altura', taskDescription: 'ab', durationHours: 4 });
    expect(res.status).toBe(400);
  });

  it('400 when kind is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ ...VALID_CREATE_BODY, kind: 'invalid_kind' });
    expect(res.status).toBe(400);
  });

  it('403 when caller lacks permit issuer role (worker role)', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'worker-1')
      .set('x-test-role', 'worker') // not in PERMIT_ISSUER_ROLES
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(403);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('forbidden');
    expect(body.reason).toBe('caller_lacks_permit_issuer_role');
  });

  it('403 when caller has no role at all', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'anon-1')
      // no x-test-role, no x-test-admin
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(403);
  });

  it('201 creates a pending_approval permit for a supervisor', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(201);
    const body = res.body as { permit: Record<string, unknown> };
    expect(body.permit).toBeDefined();
    expect(body.permit.id).toBe('wp-test-1');
    expect(body.permit.kind).toBe('altura');
    expect(body.permit.status).toBe('pending_approval');
    // Codex P1: approverUid must come from the token, never from body
    expect(body.permit.approverUid).toBe('sup-1');
    // Checklist is seeded as unchecked by the engine (never from body)
    const pre = body.permit.preconditions as Record<string, unknown>;
    const checklist = pre.checklist as { items: Array<Record<string, unknown>> };
    expect(checklist.items.every((i) => i.checked === false)).toBe(true);
    // Persisted in fakeFirestore
    const stored = (
      await H.db!.collection('tenants/t1/projects/p1/work_permits').doc('wp-test-1').get()
    ).data() as Record<string, unknown>;
    expect(stored.status).toBe('pending_approval');
  });

  it('201 creates a permit for an admin caller (admin flag sets canIssuePermits=true)', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'admin-1')
      .set('x-test-admin', 'true')
      .send({ ...VALID_CREATE_BODY, id: 'wp-admin-1', kind: 'loto' });
    expect(res.status).toBe(201);
    const body = res.body as { permit: Record<string, unknown> };
    expect(body.permit.approverRole).toBe('admin');
  });

  it('201 uses caller uid as workerUid when workerUid is not in body', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'sup-self')
      .set('x-test-role', 'supervisor')
      .send({ ...VALID_CREATE_BODY, id: 'wp-self-worker' });
    expect(res.status).toBe(201);
    const body = res.body as { permit: Record<string, unknown> };
    expect(body.permit.workerUid).toBe('sup-self');
  });

  it('201 uses explicit workerUid from body when provided', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ ...VALID_CREATE_BODY, id: 'wp-explicit-worker', workerUid: 'other-worker' });
    expect(res.status).toBe(201);
    const body = res.body as { permit: Record<string, unknown> };
    expect(body.permit.workerUid).toBe('other-worker');
  });

  it('409 when permit id already exists (duplicate)', async () => {
    // Seed an existing permit with the same id
    seedPermit(H.db!, 'wp-test-1');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send(VALID_CREATE_BODY); // id: 'wp-test-1' already exists
    expect(res.status).toBe(409);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('permit_id_duplicate');
    expect(body.permitId).toBe('wp-test-1');
  });

  it('201 works for prevencionista role via roles[] array', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'prev-1')
      .set('x-test-roles', 'prevencionista')
      .send({ ...VALID_CREATE_BODY, id: 'wp-prev-1' });
    expect(res.status).toBe(201);
    const body = res.body as { permit: Record<string, unknown> };
    expect(body.permit.approverRole).toBe('prevencionista');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /:projectId/work-permits/validate-critical
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/work-permits/validate-critical', () => {
  const LOTO_VALID_BODY = {
    kind: 'loto',
    data: {
      identifiedSources: [{ sourceId: 'src-1', type: 'electrical', isolated: true }],
      locks: [{ lockId: 'lk-1', workerUid: 'w1', type: 'personal', applied: true }],
      tryoutCompleted: true,
      residualEnergyVerified: true,
    },
  };

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/validate-critical')
      .send(LOTO_VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('403 when caller lacks permit issuer role', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/validate-critical')
      .set('x-test-uid', 'worker-1')
      .set('x-test-role', 'worker')
      .send(LOTO_VALID_BODY);
    expect(res.status).toBe(403);
    const body = res.body as Record<string, unknown>;
    expect(body.reason).toBe('caller_lacks_permit_issuer_role');
  });

  it('400 when kind is not in the critical enum', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/validate-critical')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ kind: 'altura', data: {} }); // 'altura' not in critical enum
    expect(res.status).toBe(400);
  });

  it('400 when data causes validator to throw (invalid_metadata) for loto with missing locks', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/validate-critical')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({
        kind: 'loto',
        data: {
          // identifiedSources missing entirely — validateLoto will throw
          locks: [],
          tryoutCompleted: false,
          residualEnergyVerified: false,
        },
      });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('invalid_metadata');
    expect(body.kind).toBe('loto');
  });

  it('200 returns advisory result for a valid loto submission', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/validate-critical')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send(LOTO_VALID_BODY);
    expect(res.status).toBe(200);
    const body = res.body as { result: Record<string, unknown> };
    expect(body.result).toBeDefined();
    expect(body.result.kind).toBe('loto');
    expect(Array.isArray(body.result.issues)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /:projectId/work-permits/:permitId/sign
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/work-permits/:permitId/sign', () => {
  const FULL_ATTESTATION = {
    workerHasTraining: true,
    workerHasEpp: true,
    workerMedicallyFit: true,
    checkedLabels: [
      'Verificar arnés y línea de vida',
      'Verificar superficie de apoyo / barandas',
      'Verificar condiciones climáticas (viento ≤ 60 km/h)',
      'Verificar plan rescate',
    ],
  };

  it('401 when no auth token is provided', async () => {
    seedPermit(H.db!, 'wp-sign-1');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-sign-1/sign')
      .send(FULL_ATTESTATION);
    expect(res.status).toBe(401);
  });

  it('403 when caller lacks permit issuer role', async () => {
    seedPermit(H.db!, 'wp-sign-2');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-sign-2/sign')
      .set('x-test-uid', 'worker-only')
      .set('x-test-role', 'worker')
      .send(FULL_ATTESTATION);
    expect(res.status).toBe(403);
  });

  it('404 when permit does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/nonexistent-permit/sign')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send(FULL_ATTESTATION);
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('not_found');
  });

  it('400 when attestation is missing required training flag (WorkPermitValidationError)', async () => {
    seedPermit(H.db!, 'wp-sign-3');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-sign-3/sign')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({
        workerHasTraining: false, // will trigger WORKER_MISSING_TRAINING
        workerHasEpp: true,
        workerMedicallyFit: true,
        checkedLabels: [
          'Verificar arnés y línea de vida',
          'Verificar superficie de apoyo / barandas',
          'Verificar condiciones climáticas (viento ≤ 60 km/h)',
          'Verificar plan rescate',
        ],
      });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('validation_error');
    expect(body.code).toBe('WORKER_MISSING_TRAINING');
  });

  it('400 when checklist is incomplete (missing required items)', async () => {
    seedPermit(H.db!, 'wp-sign-4');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-sign-4/sign')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({
        workerHasTraining: true,
        workerHasEpp: true,
        workerMedicallyFit: true,
        checkedLabels: ['Verificar arnés y línea de vida'], // missing 3 items
      });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.code).toBe('CHECKLIST_INCOMPLETE');
  });

  it('200 successfully attests + issues permit (pending_approval → active)', async () => {
    seedPermit(H.db!, 'wp-sign-ok');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-sign-ok/sign')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send(FULL_ATTESTATION);
    expect(res.status).toBe(200);
    const body = res.body as { permit: Record<string, unknown> };
    expect(body.permit).toBeDefined();
    expect(body.permit.status).toBe('active');
    expect(typeof body.permit.approvedAt).toBe('string');
    const pre = body.permit.preconditions as Record<string, unknown>;
    expect(pre.workerHasTraining).toBe(true);
    expect(pre.workerHasEpp).toBe(true);
    expect(pre.workerMedicallyFit).toBe(true);
    // Persisted in fakeFirestore
    const stored = (
      await H.db!.collection('tenants/t1/projects/p1/work_permits').doc('wp-sign-ok').get()
    ).data() as Record<string, unknown>;
    expect(stored.status).toBe('active');
  });

  it('200 re-signs an already-active permit (updates approvedAt, stays active)', async () => {
    seedActivePermit(H.db!, 'wp-resign');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-resign/sign')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({}); // body is optional on re-sign
    expect(res.status).toBe(200);
    const body = res.body as { permit: Record<string, unknown> };
    // The active branch just stamps approvedAt; status stays 'active'
    expect(body.permit.status).toBe('active');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /:projectId/work-permits/:permitId/close
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/work-permits/:permitId/close', () => {
  const VALID_REASON = 'Trabajo completado según plan de izaje firmado.';

  it('401 when no auth token is provided', async () => {
    seedActivePermit(H.db!, 'wp-close-auth');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-close-auth/close')
      .send({ reason: VALID_REASON });
    expect(res.status).toBe(401);
  });

  it('400 when body is missing reason field', async () => {
    seedActivePermit(H.db!, 'wp-close-noreason');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-close-noreason/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ outcome: 'fulfill' }); // no reason
    expect(res.status).toBe(400);
  });

  it('400 when reason is too short (< 10 chars)', async () => {
    seedActivePermit(H.db!, 'wp-close-short');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-close-short/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: 'short' }); // zod min(10) will reject
    expect(res.status).toBe(400);
  });

  it('404 when permit does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/ghost-permit/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: VALID_REASON });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('not_found');
  });

  it('422 when trying to close an expired permit', async () => {
    // Seed a permit whose validUntil is in the past → deriveStatus → 'expired'
    const pastValidUntil = new Date(Date.now() - 3_600_000).toISOString();
    seedActivePermit(H.db!, 'wp-expired', { validUntil: pastValidUntil });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-expired/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: VALID_REASON });
    expect(res.status).toBe(422);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('permit_already_expired');
  });

  it('422 when trying to close an already-cancelled permit', async () => {
    const now = new Date();
    seedActivePermit(H.db!, 'wp-already-cancelled', {
      status: 'cancelled',
      cancelledAt: now.toISOString(),
      cancelledReason: 'Condiciones climáticas adversas detectadas.',
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-already-cancelled/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: VALID_REASON });
    expect(res.status).toBe(422);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('permit_already_terminal');
    expect(body.status).toBe('cancelled');
  });

  it('422 when trying to close an already-fulfilled permit', async () => {
    const now = new Date();
    seedActivePermit(H.db!, 'wp-fulfilled', {
      status: 'fulfilled',
      fulfilledAt: now.toISOString(),
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-fulfilled/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: VALID_REASON });
    expect(res.status).toBe(422);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('permit_already_terminal');
    expect(body.status).toBe('fulfilled');
  });

  it('200 fulfills an active permit (default outcome)', async () => {
    seedActivePermit(H.db!, 'wp-fulfill-ok');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-fulfill-ok/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: VALID_REASON });
    expect(res.status).toBe(200);
    const body = res.body as { permit: Record<string, unknown> };
    expect(body.permit.status).toBe('fulfilled');
    expect(typeof body.permit.fulfilledAt).toBe('string');
    // Persisted
    const stored = (
      await H.db!.collection('tenants/t1/projects/p1/work_permits').doc('wp-fulfill-ok').get()
    ).data() as Record<string, unknown>;
    expect(stored.status).toBe('fulfilled');
    expect(stored.fulfilledAt).toBeTruthy();
  });

  it('200 fulfills when outcome=fulfill is explicit', async () => {
    seedActivePermit(H.db!, 'wp-fulfill-explicit');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-fulfill-explicit/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: VALID_REASON, outcome: 'fulfill' });
    expect(res.status).toBe(200);
    expect((res.body as { permit: Record<string, unknown> }).permit.status).toBe('fulfilled');
  });

  it('200 cancels an active permit when outcome=cancel', async () => {
    seedActivePermit(H.db!, 'wp-cancel-ok');
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-cancel-ok/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: 'Trabajo suspendido por condiciones climáticas adversas.', outcome: 'cancel' });
    expect(res.status).toBe(200);
    const body = res.body as { permit: Record<string, unknown> };
    expect(body.permit.status).toBe('cancelled');
    expect(typeof body.permit.cancelledAt).toBe('string');
    expect(typeof body.permit.cancelledReason).toBe('string');
    // Persisted
    const stored = (
      await H.db!.collection('tenants/t1/projects/p1/work_permits').doc('wp-cancel-ok').get()
    ).data() as Record<string, unknown>;
    expect(stored.status).toBe('cancelled');
  });

  it('400 when cancelPermit throws for a pending_approval permit (NOT_ACTIVE)', async () => {
    // pending_approval permit cannot be cancelled via close — engine throws
    seedPermit(H.db!, 'wp-pending-cancel'); // status: pending_approval
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-pending-cancel/close')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ reason: 'Cancelando permiso aún pendiente de aprobación.', outcome: 'cancel' });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('validation_error');
    expect(body.code).toBe('NOT_ACTIVE');
  });
});

// =============================================================================
// CLAUDE.md #3 (audit_logs) compliance
// =============================================================================

describe('rule #3 (audit_logs) compliance', () => {
  function auditRows(): Record<string, unknown>[] {
    return Object.entries(H.db!._dump())
      .filter(([k]) => k.startsWith('audit_logs/'))
      .map(([, v]) => v as Record<string, unknown>);
  }

  it('create writes a work_permits.create audit_logs row', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits')
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(201);
    const a = auditRows().find((r) => r.action === 'work_permits.create');
    expect(a).toBeTruthy();
    expect(a).toMatchObject({ module: 'work_permits', userId: 'sup-1', projectId: 'p1' });
    expect((a!.details as Record<string, unknown>).permitId).toBe('wp-test-1');
  });
});
