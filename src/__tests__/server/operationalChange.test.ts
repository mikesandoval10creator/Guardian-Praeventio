// Real-router supertest for Bloque 3.17 — Management of Change (MOC).
// Mounts the ACTUAL operationalChange router through fakeFirestore so this
// is genuine line coverage of the production handlers.
//
// 5 endpoints:
//   POST /:projectId/moc/declare
//   GET  /:projectId/moc/pending-acks
//   POST /:projectId/moc/:mocId/acknowledge
//   GET  /:projectId/moc/list[?kind=...&limit=N]
//   POST /:projectId/moc/:mocId/close

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
    (req as Request & { user: { uid: string; role?: string; tenantId?: string } }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
    };
    next();
  },
}));

vi.mock('../../server/middleware/validate.js', () => ({
  // Pass-through: the route reads req.body directly as z.infer<schema>.
  // Real 400 paths are exercised by the inline ChangeValidationError catches
  // and the route's own guard logic.
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
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

import operationalChangeRouter from '../../server/routes/operationalChange.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

// ── App factory ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', operationalChangeRouter);
  return app;
}

// ── Constants ────────────────────────────────────────────────────────────────

const P = 'proj1';
const TENANT = 'tenant1';
const UID = 'caller1';
const WORKER1 = 'worker1';
const WORKER2 = 'worker2';
const BASE = `/api/sprint-k/${P}/moc`;
const AUTH = { 'x-test-uid': UID };
const MOC_COL = `tenants/${TENANT}/projects/${P}/operational_changes`;

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedProject() {
  H.db!._seed(`projects/${P}`, { tenantId: TENANT });
}

/** Minimal valid body for declare. Uses supervisor role (allowed). */
const minDeclareBody = {
  kind: 'procedure' as const,
  whatChanged: 'Procedimiento de bloqueo energético actualizado',
  previousValue: 'LOTO v1',
  newValue: 'LOTO v2',
  rationale: 'Se actualizó conforme a DS 44/2024 norma aplicable. Justificación legal.',
  impact: 'medium' as const,
  affectedWorkerUids: [WORKER1, WORKER2],
  declaredByRole: 'supervisor',
  effectiveFrom: '2026-06-01T00:00:00.000Z',
};

function seedMoc(mocId: string, extra: Record<string, unknown> = {}) {
  H.db!._seed(`${MOC_COL}/${mocId}`, {
    id: mocId,
    projectId: P,
    kind: 'procedure',
    whatChanged: 'Procedimiento LOTO',
    previousValue: 'LOTO v1',
    newValue: 'LOTO v2',
    rationale: 'Actualización normativa DS 44/2024 justificación',
    impact: 'medium',
    affectedWorkerUids: [WORKER1, WORKER2],
    declaredByUid: UID,
    declaredByRole: 'supervisor',
    effectiveFrom: '2026-06-01T00:00:00.000Z',
    declaredAt: '2026-05-01T00:00:00.000Z',
    acknowledgments: [],
    status: 'in_effect',
    approvals: [],
    ...extra,
  });
}

function seedMocWithAck(mocId: string) {
  seedMoc(mocId, {
    acknowledgments: [
      { workerUid: WORKER1, ackedAt: '2026-05-10T00:00:00.000Z' },
      { workerUid: WORKER2, ackedAt: '2026-05-11T00:00:00.000Z' },
    ],
  });
}

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  seedProject();
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/moc/declare
// ────────────────────────────────────────────────────────────────────────────

describe('POST /moc/declare', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .send(minDeclareBody);
    expect(res.status).toBe(401);
  });

  it('403 when assertProjectMember throws ProjectMembershipError', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send(minDeclareBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when project doc has no tenantId', async () => {
    H.db!._seed(`projects/${P}`, { noTenantHere: true });
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send(minDeclareBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('201 happy path — returns change with id + status=draft', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send(minDeclareBody);
    expect(res.status).toBe(201);
    expect(res.body.change).toBeTruthy();
    expect(res.body.change.id).toBeTruthy();
    expect(res.body.change.projectId).toBe(P);
    expect(res.body.change.kind).toBe('procedure');
    expect(res.body.change.status).toBe('draft');
    expect(res.body.change.declaredByUid).toBe(UID);
  });

  it('201 persists change to fakeFirestore', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send(minDeclareBody);
    expect(res.status).toBe(201);
    const mocId = res.body.change.id as string;
    const stored = (await H.db!.doc(`${MOC_COL}/${mocId}`).get()).data() as Record<string, unknown>;
    expect(stored).toBeTruthy();
    expect(stored.id).toBe(mocId);
    expect(stored.declaredByUid).toBe(UID);
  });

  it('201 uses caller uid as declaredByUid (server stamps identity)', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, declaredByUid: 'attacker-uid' });
    expect(res.status).toBe(201);
    // Server MUST override any client-supplied identity
    expect(res.body.change.declaredByUid).toBe(UID);
    expect(res.body.change.declaredByUid).not.toBe('attacker-uid');
  });

  it('201 accepts optional id field', async () => {
    const customId = 'custom-moc-id-001';
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, id: customId });
    expect(res.status).toBe(201);
    expect(res.body.change.id).toBe(customId);
  });

  it('400 ChangeValidationError when role not in APPROVER_ROLES', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, declaredByRole: 'trabajador' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('400 ChangeValidationError when rationale is too short', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, rationale: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('RATIONALE_TOO_SHORT');
  });

  it('400 ChangeValidationError when previousValue === newValue', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, previousValue: 'same', newValue: 'same' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NO_DIFFERENCE');
  });

  it('400 ChangeValidationError when impact!=low and no affectedWorkerUids', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, impact: 'high', affectedWorkerUids: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('AFFECTED_REQUIRED');
  });

  it('201 allows empty affectedWorkerUids when impact=low', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, impact: 'low', affectedWorkerUids: [] });
    expect(res.status).toBe(201);
  });

  it('201 accepts optional referenceDocumentId', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, referenceDocumentId: 'doc-123' });
    expect(res.status).toBe(201);
    expect(res.body.change.referenceDocumentId).toBe('doc-123');
  });

  it('201 deduplicates affectedWorkerUids', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/declare`)
      .set(AUTH)
      .send({ ...minDeclareBody, affectedWorkerUids: [WORKER1, WORKER1, WORKER2] });
    expect(res.status).toBe(201);
    expect(res.body.change.affectedWorkerUids).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:projectId/moc/pending-acks
// ────────────────────────────────────────────────────────────────────────────

describe('GET /moc/pending-acks', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get(`${BASE}/pending-acks`);
    expect(res.status).toBe(401);
  });

  it('403 when assertProjectMember rejects', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .get(`${BASE}/pending-acks`)
      .set(AUTH);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when project has no tenantId', async () => {
    H.db!._seed(`projects/${P}`, {});
    const res = await request(buildApp())
      .get(`${BASE}/pending-acks`)
      .set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 + empty pending list when no MOCs exist', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/pending-acks`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.pending).toEqual([]);
  });

  it('200 returns MOC where caller is in affectedWorkerUids and has not acked', async () => {
    // Seed with caller in affectedWorkerUids (UID is the caller)
    H.db!._seed(`${MOC_COL}/moc-001`, {
      id: 'moc-001',
      projectId: P,
      kind: 'procedure',
      whatChanged: 'Turno cambiado',
      affectedWorkerUids: [UID, WORKER2],
      acknowledgments: [],
      status: 'in_effect',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    const res = await request(buildApp())
      .get(`${BASE}/pending-acks`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(1);
    expect(res.body.pending[0].id).toBe('moc-001');
  });

  it('200 excludes MOCs where caller has already acked', async () => {
    H.db!._seed(`${MOC_COL}/moc-002`, {
      id: 'moc-002',
      projectId: P,
      kind: 'shift',
      whatChanged: 'Turno cambiado',
      affectedWorkerUids: [UID],
      acknowledgments: [{ workerUid: UID, ackedAt: '2026-05-01T00:00:00.000Z' }],
      status: 'in_effect',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    const res = await request(buildApp())
      .get(`${BASE}/pending-acks`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(0);
  });

  it('200 excludes MOCs where caller is NOT in affectedWorkerUids', async () => {
    H.db!._seed(`${MOC_COL}/moc-003`, {
      id: 'moc-003',
      projectId: P,
      kind: 'equipment',
      whatChanged: 'Equipo reemplazado',
      affectedWorkerUids: [WORKER1, WORKER2], // caller not included
      acknowledgments: [],
      status: 'in_effect',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    const res = await request(buildApp())
      .get(`${BASE}/pending-acks`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(0);
  });

  it('200 excludes reverted MOCs', async () => {
    H.db!._seed(`${MOC_COL}/moc-004`, {
      id: 'moc-004',
      projectId: P,
      kind: 'procedure',
      whatChanged: 'Procedimiento revertido',
      affectedWorkerUids: [UID],
      acknowledgments: [],
      status: 'reverted',
      revertedAt: '2026-05-20T00:00:00.000Z',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    const res = await request(buildApp())
      .get(`${BASE}/pending-acks`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/moc/:mocId/acknowledge
// ────────────────────────────────────────────────────────────────────────────

describe('POST /moc/:mocId/acknowledge', () => {
  const MOC_ID = 'moc-ack-1';

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/acknowledge`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('403 when not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/acknowledge`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when MOC does not exist', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/nonexistent-moc/acknowledge`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('moc_not_found');
  });

  it('200 happy path — caller acks a MOC they are in audience for', async () => {
    // Caller is UID; seed the MOC with UID in affectedWorkerUids
    H.db!._seed(`${MOC_COL}/${MOC_ID}`, {
      id: MOC_ID,
      projectId: P,
      kind: 'procedure',
      whatChanged: 'Procedimiento actualizado',
      previousValue: 'v1',
      newValue: 'v2',
      rationale: 'Justificación legal adecuada',
      impact: 'medium',
      affectedWorkerUids: [UID, WORKER1],
      declaredByUid: 'admin1',
      declaredByRole: 'supervisor',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      declaredAt: '2026-05-01T00:00:00.000Z',
      acknowledgments: [],
      status: 'in_effect',
      approvals: [],
    });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/acknowledge`)
      .set(AUTH)
      .send({ ackedAt: '2026-05-30T10:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.change).toBeTruthy();
    expect(res.body.change.acknowledgments).toHaveLength(1);
    expect(res.body.change.acknowledgments[0].workerUid).toBe(UID);
    expect(res.body.change.acknowledgments[0].ackedAt).toBe('2026-05-30T10:00:00.000Z');
  });

  it('200 ack is idempotent — re-ack same worker does not duplicate', async () => {
    H.db!._seed(`${MOC_COL}/${MOC_ID}`, {
      id: MOC_ID,
      projectId: P,
      kind: 'procedure',
      whatChanged: 'Procedimiento actualizado',
      previousValue: 'v1',
      newValue: 'v2',
      rationale: 'Justificación legal adecuada',
      impact: 'low',
      affectedWorkerUids: [UID],
      declaredByUid: 'admin1',
      declaredByRole: 'supervisor',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      declaredAt: '2026-05-01T00:00:00.000Z',
      acknowledgments: [{ workerUid: UID, ackedAt: '2026-05-10T00:00:00.000Z' }],
      status: 'in_effect',
      approvals: [],
    });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/acknowledge`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(200);
    // Must remain at 1, not 2
    expect(res.body.change.acknowledgments).toHaveLength(1);
  });

  it('400 ChangeValidationError when caller is not in affectedWorkerUids', async () => {
    H.db!._seed(`${MOC_COL}/${MOC_ID}`, {
      id: MOC_ID,
      projectId: P,
      kind: 'procedure',
      whatChanged: 'Procedimiento actualizado',
      previousValue: 'v1',
      newValue: 'v2',
      rationale: 'Justificación legal adecuada',
      impact: 'low',
      affectedWorkerUids: [WORKER1, WORKER2], // caller NOT included
      declaredByUid: 'admin1',
      declaredByRole: 'supervisor',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      declaredAt: '2026-05-01T00:00:00.000Z',
      acknowledgments: [],
      status: 'in_effect',
      approvals: [],
    });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/acknowledge`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NOT_IN_AUDIENCE');
  });

  it('400 ChangeValidationError when MOC is reverted', async () => {
    H.db!._seed(`${MOC_COL}/${MOC_ID}`, {
      id: MOC_ID,
      projectId: P,
      kind: 'procedure',
      whatChanged: 'Procedimiento actualizado',
      previousValue: 'v1',
      newValue: 'v2',
      rationale: 'Justificación legal adecuada',
      impact: 'low',
      affectedWorkerUids: [UID],
      declaredByUid: 'admin1',
      declaredByRole: 'supervisor',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      declaredAt: '2026-05-01T00:00:00.000Z',
      acknowledgments: [],
      revertedAt: '2026-05-20T00:00:00.000Z',
      status: 'reverted',
      approvals: [],
    });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/acknowledge`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('CHANGE_REVERTED');
  });

  it('200 persists ack to fakeFirestore', async () => {
    H.db!._seed(`${MOC_COL}/${MOC_ID}`, {
      id: MOC_ID,
      projectId: P,
      kind: 'procedure',
      whatChanged: 'Procedimiento actualizado',
      previousValue: 'v1',
      newValue: 'v2',
      rationale: 'Justificación legal adecuada',
      impact: 'low',
      affectedWorkerUids: [UID],
      declaredByUid: 'admin1',
      declaredByRole: 'supervisor',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      declaredAt: '2026-05-01T00:00:00.000Z',
      acknowledgments: [],
      status: 'in_effect',
      approvals: [],
    });
    await request(buildApp())
      .post(`${BASE}/${MOC_ID}/acknowledge`)
      .set(AUTH)
      .send({ ackedAt: '2026-05-30T10:00:00.000Z' });
    const stored = (await H.db!.doc(`${MOC_COL}/${MOC_ID}`).get()).data() as Record<string, unknown>;
    const acks = stored.acknowledgments as Array<{ workerUid: string; ackedAt: string }>;
    expect(acks).toHaveLength(1);
    expect(acks[0].workerUid).toBe(UID);
  });

  it('200 uses current timestamp when ackedAt not provided', async () => {
    H.db!._seed(`${MOC_COL}/${MOC_ID}`, {
      id: MOC_ID,
      projectId: P,
      kind: 'procedure',
      whatChanged: 'Procedimiento actualizado',
      previousValue: 'v1',
      newValue: 'v2',
      rationale: 'Justificación legal adecuada',
      impact: 'low',
      affectedWorkerUids: [UID],
      declaredByUid: 'admin1',
      declaredByRole: 'supervisor',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      declaredAt: '2026-05-01T00:00:00.000Z',
      acknowledgments: [],
      status: 'in_effect',
      approvals: [],
    });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/acknowledge`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(200);
    const ack = res.body.change.acknowledgments[0] as { workerUid: string; ackedAt: string };
    expect(ack.workerUid).toBe(UID);
    expect(ack.ackedAt).toBeTruthy(); // server-stamped ISO string
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:projectId/moc/list
// ────────────────────────────────────────────────────────────────────────────

describe('GET /moc/list', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get(`${BASE}/list`);
    expect(res.status).toBe(401);
  });

  it('403 when not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .get(`${BASE}/list`)
      .set(AUTH);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when project has no tenantId', async () => {
    H.db!._seed(`projects/${P}`, {});
    const res = await request(buildApp())
      .get(`${BASE}/list`)
      .set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 + empty items + summaries when no MOCs exist', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/list`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.summaries).toEqual([]);
  });

  it('200 returns items and summaries for existing MOCs', async () => {
    seedMoc('m1');
    const res = await request(buildApp())
      .get(`${BASE}/list`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.summaries).toHaveLength(1);
    expect(res.body.summaries[0].changeId).toBe('m1');
    expect(typeof res.body.summaries[0].coveragePercent).toBe('number');
  });

  it('200 filters by valid kind query param', async () => {
    seedMoc('m-proc', { kind: 'procedure', effectiveFrom: '2026-06-02T00:00:00.000Z' });
    seedMoc('m-equip', { kind: 'equipment', effectiveFrom: '2026-06-01T00:00:00.000Z' });
    const res = await request(buildApp())
      .get(`${BASE}/list?kind=equipment`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].kind).toBe('equipment');
  });

  it('200 ignores invalid kind query param (falls back to no filter)', async () => {
    seedMoc('m-any', { kind: 'procedure' });
    const res = await request(buildApp())
      .get(`${BASE}/list?kind=invalid_kind`)
      .set(AUTH);
    expect(res.status).toBe(200);
    // Returns all since invalid kind is ignored
    expect(res.body.items).toHaveLength(1);
  });

  it('200 respects limit param (capped at 500)', async () => {
    // Seed 3 docs, request limit=2
    seedMoc('m-a', { effectiveFrom: '2026-06-03T00:00:00.000Z' });
    seedMoc('m-b', { effectiveFrom: '2026-06-02T00:00:00.000Z' });
    seedMoc('m-c', { effectiveFrom: '2026-06-01T00:00:00.000Z' });
    const res = await request(buildApp())
      .get(`${BASE}/list?limit=2`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it('200 defaults limit to 50 when not specified or invalid', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/list?limit=bogus`)
      .set(AUTH);
    expect(res.status).toBe(200);
    // No error — just uses default 50
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('200 includes acknowledgment summary with coveragePercent=0 when no acks', async () => {
    seedMoc('m-noack');
    const res = await request(buildApp())
      .get(`${BASE}/list`)
      .set(AUTH);
    expect(res.status).toBe(200);
    const summary = res.body.summaries[0] as Record<string, unknown>;
    expect(summary.coveragePercent).toBe(0);
    expect(summary.totalAffected).toBe(2);
    expect(summary.acknowledged).toBe(0);
    expect(summary.pending).toBe(2);
  });

  it('200 includes acknowledgment summary with coveragePercent=100 when all acked', async () => {
    seedMocWithAck('m-fullack');
    const res = await request(buildApp())
      .get(`${BASE}/list`)
      .set(AUTH);
    expect(res.status).toBe(200);
    const summary = res.body.summaries[0] as Record<string, unknown>;
    expect(summary.coveragePercent).toBe(100);
    expect(summary.acknowledged).toBe(2);
    expect(summary.pending).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/moc/:mocId/close
// ────────────────────────────────────────────────────────────────────────────

describe('POST /moc/:mocId/close', () => {
  const MOC_ID = 'moc-close-1';

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('403 when not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when MOC does not exist', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/nonexistent-moc/close`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('moc_not_found');
  });

  it('400 when MOC is reverted (cannot close a reverted MOC)', async () => {
    seedMoc(MOC_ID, { revertedAt: '2026-05-20T00:00:00.000Z', status: 'reverted' });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('CHANGE_REVERTED');
  });

  it('409 ACK_COVERAGE_INCOMPLETE when not all workers have acked', async () => {
    // Seed with WORKER1 acked but WORKER2 not
    seedMoc(MOC_ID, {
      affectedWorkerUids: [WORKER1, WORKER2],
      acknowledgments: [{ workerUid: WORKER1, ackedAt: '2026-05-10T00:00:00.000Z' }],
    });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ack_coverage_incomplete');
    expect(res.body.code).toBe('ACK_COVERAGE_INCOMPLETE');
    expect(res.body.pendingWorkerUids).toContain(WORKER2);
  });

  it('409 includes pending worker list in response', async () => {
    seedMoc(MOC_ID, {
      affectedWorkerUids: [WORKER1, WORKER2],
      acknowledgments: [],
    });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.pendingWorkerUids).toHaveLength(2);
    expect(res.body.pendingWorkerUids).toContain(WORKER1);
    expect(res.body.pendingWorkerUids).toContain(WORKER2);
  });

  it('200 closes MOC when all workers have acked', async () => {
    seedMocWithAck(MOC_ID);
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({ closingNote: 'Implementado correctamente el 2026-05-30.' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mocId).toBe(MOC_ID);
    expect(res.body.implementedAt).toBeTruthy();
    expect(res.body.implementedBy).toBe(UID);
  });

  it('200 close persists implementedAt + implementedBy to fakeFirestore', async () => {
    seedMocWithAck(MOC_ID);
    await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({});
    const stored = (await H.db!.doc(`${MOC_COL}/${MOC_ID}`).get()).data() as Record<string, unknown>;
    expect(stored.implementedAt).toBeTruthy();
    expect(stored.implementedBy).toBe(UID);
  });

  it('200 persists closingNote to fakeFirestore', async () => {
    seedMocWithAck(MOC_ID);
    await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({ closingNote: 'Cerrado correctamente.' });
    const stored = (await H.db!.doc(`${MOC_COL}/${MOC_ID}`).get()).data() as Record<string, unknown>;
    expect(stored.closingNote).toBe('Cerrado correctamente.');
  });

  it('200 sets closingNote to null when not provided', async () => {
    seedMocWithAck(MOC_ID);
    await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({});
    const stored = (await H.db!.doc(`${MOC_COL}/${MOC_ID}`).get()).data() as Record<string, unknown>;
    expect(stored.closingNote).toBeNull();
  });

  it('200 close stamps caller uid as implementedBy (server-side identity)', async () => {
    seedMocWithAck(MOC_ID);
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(200);
    // Must use server-verified uid, not any client-supplied value
    expect(res.body.implementedBy).toBe(UID);
  });

  it('200 coverage=100 when affectedWorkerUids is empty (no workers = 100%)', async () => {
    // affectedWorkerUids=[] → totalAffected=0 → coveragePercent=100
    seedMoc(MOC_ID, {
      affectedWorkerUids: [],
      acknowledgments: [],
    });
    const res = await request(buildApp())
      .post(`${BASE}/${MOC_ID}/close`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
