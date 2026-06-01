// Real-router supertest for the corrective-actions endpoints (F.4 Center).
// Mounts the REAL router so v8 coverage counts route code. This route had
// NO dedicated test before — added alongside the Rule #3 audit-log inserts
// (campaign 2026-05-31, §2.29). Covers auth/validation/guard paths + the
// two mutating handlers' audit_logs trail.

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

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import correctiveActionsRouter from '../../server/routes/correctiveActions.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', correctiveActionsRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

const TENANT_ID = 'tenant-abc';
const PROJECT_ID = 'proj-alpha';
const MEMBER_UID = 'worker1';
const OUTSIDER_UID = 'intruder9';

const CA_PATH = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/corrective_actions`;

/** Seed the project doc so assertProjectMember + resolveTenantId both pass. */
function seedProject(
  db: ReturnType<typeof createFakeFirestore>,
  extra: Record<string, unknown> = {},
) {
  db._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
    ...extra,
  });
}

function auditRows(): Record<string, unknown>[] {
  return Object.entries(H.db!._dump())
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v as Record<string, unknown>);
}

const validCreate = {
  id: 'ca-001',
  description: 'Instalar baranda en plataforma nivel 3',
  level: 'engineering' as const,
  status: 'open' as const,
  isSystemic: false,
};

beforeEach(() => {
  H.db = createFakeFirestore();
});

// =============================================================================
// GET /:projectId/corrective-actions
// =============================================================================

describe('GET /api/sprint-k/:projectId/corrective-actions', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get(
      `/api/sprint-k/${PROJECT_ID}/corrective-actions`,
    );
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    seedProject(H.db!); // members = [MEMBER_UID]
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/corrective-actions`)
      .set(asUser(OUTSIDER_UID));
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('404 when project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID] }); // no tenantId
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/corrective-actions`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_not_found');
  });

  it('200 returns actions filtered by status + systemic bucket', async () => {
    seedProject(H.db!);
    H.db!._seed(`${CA_PATH}/ca-open`, {
      id: 'ca-open',
      description: 'open one',
      status: 'open',
      isSystemic: false,
    });
    H.db!._seed(`${CA_PATH}/ca-sys`, {
      id: 'ca-sys',
      description: 'systemic one',
      status: 'closed',
      isSystemic: true,
    });
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/corrective-actions`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as { actions: Array<Record<string, unknown>>; systemic: Array<Record<string, unknown>> };
    // default status filter = 'open'
    expect(body.actions.map((a) => a.id)).toEqual(['ca-open']);
    expect(body.systemic.map((a) => a.id)).toEqual(['ca-sys']);
  });

  it('200 respects ?status= query param', async () => {
    seedProject(H.db!);
    H.db!._seed(`${CA_PATH}/ca-verified`, {
      id: 'ca-verified',
      description: 'verified one',
      status: 'verified',
      isSystemic: false,
    });
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/corrective-actions?status=verified`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as { actions: Array<Record<string, unknown>> };
    expect(body.actions.map((a) => a.id)).toEqual(['ca-verified']);
  });
});

// =============================================================================
// POST /:projectId/corrective-actions  (create)
// =============================================================================

describe('POST /api/sprint-k/:projectId/corrective-actions', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/corrective-actions`)
      .send(validCreate);
    expect(res.status).toBe(401);
  });

  it('400 when payload is invalid (bad status enum)', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/corrective-actions`)
      .set(asUser(MEMBER_UID))
      .send({ ...validCreate, status: 'banana' });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a project member', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/corrective-actions`)
      .set(asUser(OUTSIDER_UID))
      .send(validCreate);
    expect(res.status).toBe(403);
  });

  it('201 persists the action + writes an audit_logs row', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/corrective-actions`)
      .set(asUser(MEMBER_UID))
      .send(validCreate);
    expect(res.status).toBe(201);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    // Firestore write
    const stored = H.db!._store.get(`${CA_PATH}/${validCreate.id}`);
    expect(stored).toBeDefined();
    expect(stored?.description).toBe(validCreate.description);
    // Rule #3 — audit trail
    const a = auditRows().find((r) => r.action === 'correctiveActions.create');
    expect(a).toBeTruthy();
    expect(a).toMatchObject({
      module: 'correctiveActions',
      userId: MEMBER_UID,
      projectId: PROJECT_ID,
    });
    expect((a!.details as Record<string, unknown>).actionId).toBe(validCreate.id);
  });
});

// =============================================================================
// POST /:projectId/corrective-actions/:actionId/effectiveness-review
// =============================================================================

describe('POST /api/sprint-k/:projectId/corrective-actions/:actionId/effectiveness-review', () => {
  const reviewBody = { actionId: 'ca-001', reviewAt: '2026-09-01' };

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/corrective-actions/ca-001/effectiveness-review`)
      .send(reviewBody);
    expect(res.status).toBe(401);
  });

  it('400 when body.actionId does not match the path param', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/corrective-actions/ca-DIFFERENT/effectiveness-review`)
      .set(asUser(MEMBER_UID))
      .send(reviewBody);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('actionId_mismatch');
  });

  it('204 schedules the review (persists effectivenessReviewAt) + writes an audit_logs row', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/corrective-actions/ca-001/effectiveness-review`)
      .set(asUser(MEMBER_UID))
      .send(reviewBody);
    expect(res.status).toBe(204);
    const stored = H.db!._store.get(`${CA_PATH}/ca-001`);
    expect(stored?.effectivenessReviewAt).toBe(reviewBody.reviewAt);
    expect(stored?.effectivenessReviewScheduledBy).toBe(MEMBER_UID);
    // Rule #3 — audit trail
    const a = auditRows().find((r) => r.action === 'correctiveActions.scheduleReview');
    expect(a).toBeTruthy();
    expect(a).toMatchObject({ module: 'correctiveActions', userId: MEMBER_UID, projectId: PROJECT_ID });
  });
});
