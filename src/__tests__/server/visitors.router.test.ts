// Real-router supertest for the visitors endpoints.
// Mounts the REAL router so v8 coverage counts route code.
// Sprint 39 / Plan v3 coverage campaign — §23-24 Control de Visitas.

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

// idempotencyKey uses Firestore + crypto internally; mock as passthrough
// so tests don't need idempotency-key headers and cache writes don't interfere.
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  IDEMPOTENCY_DEFAULT_TTL_SEC: 86400,
  IDEMPOTENCY_CACHE_COLLECTION: 'system_idempotency_cache',
  IDEMPOTENCY_HEADER: 'idempotency-key',
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// observability/index is imported transitively by verifyAuth + captureRouteError
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// visitorRegistry is pure-compute — let the REAL module run so its lines
// are covered. We do NOT mock it.

import visitorsRouter from '../../server/routes/visitors.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/visitors', visitorsRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

const TENANT_ID = 'tenant-abc';
const PROJECT_ID = 'proj-alpha';
const HOST_UID = 'worker1';

/** Seed the project doc so tenantIdFor() resolves correctly. */
function seedProject(db: ReturnType<typeof createFakeFirestore>) {
  db._seed(`projects/${PROJECT_ID}`, { tenantId: TENANT_ID });
}

/** A valid check-in body. */
const validCheckIn = {
  projectId: PROJECT_ID,
  fullName: 'Juan Pérez',
  rut: '12.345.678-9',
  company: 'Acme Ltda',
  reason: 'Auditoría interna',
};

/** Seed a visitor doc for routes that require an existing visitor. */
function seedVisitor(
  db: ReturnType<typeof createFakeFirestore>,
  visitorId: string,
  extra: Record<string, unknown> = {},
) {
  db._seed(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/visitors/${visitorId}`, {
    id: visitorId,
    fullName: 'Juan Pérez',
    rut: '12345678-9',
    company: 'Acme Ltda',
    hostUid: HOST_UID,
    reason: 'Auditoría interna',
    inductionVersionId: '',
    checkInAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    tenantId: TENANT_ID,
    ...extra,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

// =============================================================================
// POST /api/visitors/check-in
// =============================================================================

describe('POST /api/visitors/check-in', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/check-in')
      .send(validCheckIn);
    expect(res.status).toBe(401);
  });

  it('400 when required field missing (no fullName)', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/check-in')
      .set(asUser(HOST_UID))
      .send({ projectId: PROJECT_ID, rut: '12.345.678-9', company: 'A', reason: 'test' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when projectId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/check-in')
      .set(asUser(HOST_UID))
      .send({ fullName: 'Juan Pérez', rut: '12.345.678-9', company: 'A', reason: 'test' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when project has no tenant (project_missing_tenant)', async () => {
    // Project not seeded → tenantIdFor returns null
    const res = await request(buildApp())
      .post('/api/visitors/check-in')
      .set(asUser(HOST_UID))
      .send(validCheckIn);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('project_missing_tenant');
  });

  it('400 when RUT is malformed (VisitorRegistryError from pure engine)', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/visitors/check-in')
      .set(asUser(HOST_UID))
      .send({ ...validCheckIn, rut: 'not-a-rut' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('INVALID_RUT');
  });

  it('200 happy path — visitor doc written + response shape correct', async () => {
    seedProject(H.db!);
    const visitorId = 'vis-test-001';
    const res = await request(buildApp())
      .post('/api/visitors/check-in')
      .set(asUser(HOST_UID))
      .send({ ...validCheckIn, id: visitorId });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const visitor = body.visitor as Record<string, unknown>;
    expect(visitor.id).toBe(visitorId);
    expect(visitor.hostUid).toBe(HOST_UID);
    expect(visitor.projectId).toBe(PROJECT_ID);
    expect(visitor.tenantId).toBe(TENANT_ID);
    // Verify Firestore write happened
    const stored = H.db!._store.get(
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/visitors/${visitorId}`,
    );
    expect(stored).toBeDefined();
    expect(stored?.fullName).toBe('Juan Pérez');
  });

  it('200 auto-generates visitorId when id omitted', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/visitors/check-in')
      .set(asUser(HOST_UID))
      .send(validCheckIn);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const visitor = body.visitor as Record<string, unknown>;
    expect(typeof visitor.id).toBe('string');
    expect((visitor.id as string).startsWith('vis_')).toBe(true);
  });
});

// =============================================================================
// POST /api/visitors/:id/check-out
// =============================================================================

describe('POST /api/visitors/:id/check-out', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/vis-001/check-out')
      .send({ projectId: PROJECT_ID });
    expect(res.status).toBe(401);
  });

  it('400 when projectId missing from body', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/vis-001/check-out')
      .set(asUser(HOST_UID))
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when project has no tenant (project_missing_tenant)', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/vis-001/check-out')
      .set(asUser(HOST_UID))
      .send({ projectId: PROJECT_ID });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('project_missing_tenant');
  });

  it('404 when visitor does not exist', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/visitors/vis-does-not-exist/check-out')
      .set(asUser(HOST_UID))
      .send({ projectId: PROJECT_ID });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('visitor_not_found');
  });

  it('200 happy path — checkOutAt written to Firestore + response shape correct', async () => {
    seedProject(H.db!);
    const visitorId = 'vis-checkout-001';
    seedVisitor(H.db!, visitorId);
    const res = await request(buildApp())
      .post(`/api/visitors/${visitorId}/check-out`)
      .set(asUser(HOST_UID))
      .send({ projectId: PROJECT_ID });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.visitorId).toBe(visitorId);
    expect(typeof body.checkOutAt).toBe('string');
    // Verify Firestore update
    const stored = H.db!._store.get(
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/visitors/${visitorId}`,
    );
    expect(stored?.checkOutAt).toBeDefined();
  });
});

// =============================================================================
// POST /api/visitors/:id/acknowledge-induction
// =============================================================================

describe('POST /api/visitors/:id/acknowledge-induction', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/vis-001/acknowledge-induction')
      .send({ inductionVersionId: 'v1', projectId: PROJECT_ID });
    expect(res.status).toBe(401);
  });

  it('400 when inductionVersionId missing (Zod validate)', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/vis-001/acknowledge-induction')
      .set(asUser(HOST_UID))
      .send({ projectId: PROJECT_ID });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when projectId missing from body (route-level guard)', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/vis-001/acknowledge-induction')
      .set(asUser(HOST_UID))
      .send({ inductionVersionId: 'v1' });
    // projectId empty string → invalid_payload guard fires
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when project has no tenant (project_missing_tenant)', async () => {
    const res = await request(buildApp())
      .post('/api/visitors/vis-001/acknowledge-induction')
      .set(asUser(HOST_UID))
      .send({ inductionVersionId: 'v1', projectId: PROJECT_ID });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('project_missing_tenant');
  });

  it('404 when visitor does not exist', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/visitors/vis-no-such/acknowledge-induction')
      .set(asUser(HOST_UID))
      .send({ inductionVersionId: 'v1', projectId: PROJECT_ID });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('visitor_not_found');
  });

  it('200 happy path — inductionVersionId + inductedAt written to Firestore', async () => {
    seedProject(H.db!);
    const visitorId = 'vis-induction-001';
    seedVisitor(H.db!, visitorId);
    const res = await request(buildApp())
      .post(`/api/visitors/${visitorId}/acknowledge-induction`)
      .set(asUser(HOST_UID))
      .send({ inductionVersionId: 'ind-v2', projectId: PROJECT_ID });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.visitorId).toBe(visitorId);
    expect(body.inductionVersionId).toBe('ind-v2');
    expect(typeof body.inductedAt).toBe('string');
    // Verify Firestore update
    const stored = H.db!._store.get(
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/visitors/${visitorId}`,
    );
    expect(stored?.inductionVersionId).toBe('ind-v2');
    expect(stored?.inductedAt).toBeDefined();
  });
});

// =============================================================================
// GET /api/visitors?projectId=…
// =============================================================================

describe('GET /api/visitors', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get('/api/visitors?projectId=proj-alpha');
    expect(res.status).toBe(401);
  });

  it('400 when projectId query param missing', async () => {
    const res = await request(buildApp())
      .get('/api/visitors')
      .set(asUser(HOST_UID));
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 when project has no tenant (project_missing_tenant)', async () => {
    const res = await request(buildApp())
      .get(`/api/visitors?projectId=${PROJECT_ID}`)
      .set(asUser(HOST_UID));
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('project_missing_tenant');
  });

  it('200 returns only active visitors (no checkOutAt)', async () => {
    seedProject(H.db!);
    const activeId = 'vis-active-001';
    const checkedOutId = 'vis-done-001';
    seedVisitor(H.db!, activeId);
    seedVisitor(H.db!, checkedOutId, { checkOutAt: new Date().toISOString() });
    const res = await request(buildApp())
      .get(`/api/visitors?projectId=${PROJECT_ID}`)
      .set(asUser(HOST_UID));
    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; visitors: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.visitors.length).toBe(1);
    expect(body.visitors[0].id).toBe(activeId);
  });

  it('200 returns empty array when no active visitors', async () => {
    seedProject(H.db!);
    // seed only checked-out
    seedVisitor(H.db!, 'vis-past-001', { checkOutAt: new Date().toISOString() });
    const res = await request(buildApp())
      .get(`/api/visitors?projectId=${PROJECT_ID}`)
      .set(asUser(HOST_UID));
    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; visitors: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.visitors).toHaveLength(0);
  });
});

// =============================================================================
// CLAUDE.md #19 (runTransaction) + #3 (audit_logs) compliance
// =============================================================================

describe('rule #19 (transaction) + #3 (audit_logs) compliance', () => {
  function auditRows(): Record<string, unknown>[] {
    return Object.entries(H.db!._dump())
      .filter(([k]) => k.startsWith('audit_logs/'))
      .map(([, v]) => v as Record<string, unknown>);
  }

  it('check-in writes an audit_logs row', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/visitors/check-in')
      .set(asUser(HOST_UID))
      .send({ ...validCheckIn, id: 'vis-audit-ci' });
    expect(res.status).toBe(200);
    const a = auditRows().find((r) => r.action === 'visitors.check_in');
    expect(a).toBeTruthy();
    expect(a).toMatchObject({ module: 'visitors', userId: HOST_UID, projectId: PROJECT_ID });
  });

  it('check-out runs in a transaction + writes an audit_logs row', async () => {
    seedProject(H.db!);
    const visitorId = 'vis-audit-co';
    seedVisitor(H.db!, visitorId);
    const txSpy = vi.spyOn(H.db!, 'runTransaction');
    const res = await request(buildApp())
      .post(`/api/visitors/${visitorId}/check-out`)
      .set(asUser(HOST_UID))
      .send({ projectId: PROJECT_ID });
    expect(res.status).toBe(200);
    expect(txSpy).toHaveBeenCalledTimes(1);
    expect(auditRows().some((r) => r.action === 'visitors.check_out')).toBe(true);
  });

  it('acknowledge-induction runs in a transaction + writes an audit_logs row', async () => {
    seedProject(H.db!);
    const visitorId = 'vis-audit-ack';
    seedVisitor(H.db!, visitorId);
    const txSpy = vi.spyOn(H.db!, 'runTransaction');
    const res = await request(buildApp())
      .post(`/api/visitors/${visitorId}/acknowledge-induction`)
      .set(asUser(HOST_UID))
      .send({ inductionVersionId: 'ind-v9', projectId: PROJECT_ID });
    expect(res.status).toBe(200);
    expect(txSpy).toHaveBeenCalledTimes(1);
    expect(auditRows().some((r) => r.action === 'visitors.acknowledge_induction')).toBe(true);
  });
});
