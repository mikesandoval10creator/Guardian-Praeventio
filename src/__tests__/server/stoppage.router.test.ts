// Real-router supertest for src/server/routes/stoppage.ts
// Coverage target: POST /:projectId/stoppage/{declare,mark-precondition-fulfilled,resume,cancel,summarize}
// The route is stateless (pure-engine calls) + assertProjectMember (Firestore read only).
// No audit_logs writes happen in this route — engine is pure, no side effects.

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

vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import stoppageRouter from '../../server/routes/stoppage.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', stoppageRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const PROJECT = 'proj-alpha';
const MEMBER_UID = 'uid-member';
const OTHER_UID = 'uid-stranger';

/** Minimal project doc that passes assertProjectMember */
function seedProject(db: ReturnType<typeof createFakeFirestore>) {
  db._seed(`projects/${PROJECT}`, {
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
}

/** A valid active Stoppage object for mutation endpoints */
const activeStoppage = {
  id: 'stop-001',
  projectId: PROJECT,
  category: 'incidente_grave',
  scope: 'zone',
  scopeTargetId: 'zone-42',
  reason: 'Grave riesgo detectado en la zona de excavación',
  declaredByUid: MEMBER_UID,
  declaredByRole: 'supervisor',
  declaredAt: new Date('2026-05-31T10:00:00Z').toISOString(),
  status: 'active' as const,
  resumptionPreconditions: [
    { id: 'pc-1', label: 'Inspección completada', fulfilled: false },
  ],
};

/** Stoppage with all preconditions fulfilled — ready for resume */
const pendingStoppage = {
  ...activeStoppage,
  status: 'pending_resumption' as const,
  resumptionPreconditions: [
    {
      id: 'pc-1',
      label: 'Inspección completada',
      fulfilled: true,
      fulfilledByUid: MEMBER_UID,
      fulfilledAt: new Date('2026-05-31T11:00:00Z').toISOString(),
    },
  ],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ============================================================================
// POST /:projectId/stoppage/declare
// ============================================================================
describe('POST /:projectId/stoppage/declare', () => {
  const ENDPOINT = `/api/${PROJECT}/stoppage/declare`;

  const validBody = {
    id: 'stop-001',
    category: 'incidente_grave',
    scope: 'zone',
    scopeTargetId: 'zone-42',
    reason: 'Grave riesgo detectado en la zona de excavación',
    declaredByRole: 'supervisor',
    resumptionPreconditions: [
      { id: 'pc-1', label: 'Inspección completada' },
    ],
  };

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 for non-member caller', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(OTHER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('400 for invalid body (missing required field)', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ ...validBody, category: undefined });
    expect(res.status).toBe(400);
  });

  it('400 for empty resumptionPreconditions array', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ ...validBody, resumptionPreconditions: [] });
    expect(res.status).toBe(400);
  });

  it('200 happy path — returns stoppage with correct shape', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send(validBody);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.stoppage).toBeDefined();
    const s = body.stoppage as Record<string, unknown>;
    expect(s.id).toBe('stop-001');
    expect(s.projectId).toBe(PROJECT);
    expect(s.status).toBe('active');
    expect(s.declaredByUid).toBe(MEMBER_UID);
    expect(s.declaredByRole).toBe('supervisor');
    expect(Array.isArray(s.resumptionPreconditions)).toBe(true);
  });

  it('400 from engine — reason too short triggers StoppageValidationError → 400', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ ...validBody, reason: 'short' });
    // zod passes (reason ≥1 char) but engine throws REASON_TOO_SHORT → asEngineError → 400
    expect(res.status).toBe(400);
  });

  it('400 from engine — wrong role for non-voluntary category', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ ...validBody, declaredByRole: 'operario' });
    expect(res.status).toBe(400);
  });

  it('200 — detencion_voluntaria allows any role', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ ...validBody, category: 'detencion_voluntaria', declaredByRole: 'operario' });
    expect(res.status).toBe(200);
    const s = (res.body as { stoppage: Record<string, unknown> }).stoppage;
    expect(s.category).toBe('detencion_voluntaria');
  });
});

// ============================================================================
// POST /:projectId/stoppage/mark-precondition-fulfilled
// ============================================================================
describe('POST /:projectId/stoppage/mark-precondition-fulfilled', () => {
  const ENDPOINT = `/api/${PROJECT}/stoppage/mark-precondition-fulfilled`;

  const validBody = {
    stoppage: activeStoppage,
    preconditionId: 'pc-1',
    evidenceUrl: 'https://evidence.example.com/photo.jpg',
  };

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 for non-member caller', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(OTHER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 for invalid body — missing stoppage', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ preconditionId: 'pc-1' });
    expect(res.status).toBe(400);
  });

  it('200 happy path — precondition marked fulfilled, status → pending_resumption', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send(validBody);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const s = body.stoppage as Record<string, unknown>;
    expect(s.status).toBe('pending_resumption');
    const pcs = s.resumptionPreconditions as Array<Record<string, unknown>>;
    expect(pcs[0].fulfilled).toBe(true);
    expect(pcs[0].fulfilledByUid).toBe(MEMBER_UID);
  });

  it('400 from engine — stoppage already cancelled → NOT_OPEN', async () => {
    const cancelledStoppage = { ...activeStoppage, status: 'cancelled' as const };
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppage: cancelledStoppage, preconditionId: 'pc-1' });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// POST /:projectId/stoppage/resume
// ============================================================================
describe('POST /:projectId/stoppage/resume', () => {
  const ENDPOINT = `/api/${PROJECT}/stoppage/resume`;

  const validBody = {
    stoppage: pendingStoppage,
    resumedByRole: 'supervisor',
  };

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 for non-member caller', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(OTHER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 for invalid body — missing stoppage', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ resumedByRole: 'supervisor' });
    expect(res.status).toBe(400);
  });

  it('200 happy path — status → resumed, resumedByUid = caller', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send(validBody);
    expect(res.status).toBe(200);
    const s = (res.body as { stoppage: Record<string, unknown> }).stoppage;
    expect(s.status).toBe('resumed');
    expect(s.resumedByUid).toBe(MEMBER_UID);
    expect(typeof s.resumedAt).toBe('string');
  });

  it('400 from engine — stoppage still active (not all preconditions met)', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppage: activeStoppage, resumedByRole: 'supervisor' });
    expect(res.status).toBe(400);
  });

  it('400 from engine — operario role cannot approve resumption', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppage: pendingStoppage, resumedByRole: 'operario' });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// POST /:projectId/stoppage/cancel
// ============================================================================
describe('POST /:projectId/stoppage/cancel', () => {
  const ENDPOINT = `/api/${PROJECT}/stoppage/cancel`;

  const validBody = {
    stoppage: activeStoppage,
    reason: 'Paralización mal declarada por error del operario en turno',
  };

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 for non-member caller', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(OTHER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 for invalid body — reason too short for zod (min 15 chars)', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppage: activeStoppage, reason: 'short' });
    // zod cancelSchema requires reason min:15 → 400 from validate middleware
    expect(res.status).toBe(400);
  });

  it('400 for invalid body — missing reason', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppage: activeStoppage });
    expect(res.status).toBe(400);
  });

  it('200 happy path — status → cancelled, cancelledByUid = caller', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send(validBody);
    expect(res.status).toBe(200);
    const s = (res.body as { stoppage: Record<string, unknown> }).stoppage;
    expect(s.status).toBe('cancelled');
    expect(s.cancelledByUid).toBe(MEMBER_UID);
    expect(typeof s.cancelledAt).toBe('string');
  });

  it('400 from engine — cannot cancel an already-resumed stoppage', async () => {
    const resumedStoppage = {
      ...activeStoppage,
      status: 'resumed' as const,
      resumedAt: new Date().toISOString(),
      resumedByUid: MEMBER_UID,
    };
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppage: resumedStoppage, reason: validBody.reason });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// POST /:projectId/stoppage/summarize
// ============================================================================
describe('POST /:projectId/stoppage/summarize', () => {
  const ENDPOINT = `/api/${PROJECT}/stoppage/summarize`;

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send({ stoppages: [] });
    expect(res.status).toBe(401);
  });

  it('403 for non-member caller', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(OTHER_UID))
      .send({ stoppages: [] });
    expect(res.status).toBe(403);
  });

  it('400 for invalid body — stoppages not an array', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppages: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('200 happy path — empty array returns zero summary', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppages: [] });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.summary).toBeDefined();
    const summary = body.summary as Record<string, unknown>;
    expect(summary.total).toBe(0);
    expect(summary.active).toBe(0);
    expect(summary.resumed).toBe(0);
    expect(summary.cancelled).toBe(0);
  });

  it('200 happy path — mixed stoppages aggregated correctly', async () => {
    const stoppages = [
      activeStoppage,
      pendingStoppage,
      { ...activeStoppage, id: 'stop-003', status: 'resumed' as const },
      { ...activeStoppage, id: 'stop-004', status: 'cancelled' as const },
    ];
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(MEMBER_UID))
      .send({ stoppages });
    expect(res.status).toBe(200);
    const summary = (res.body as { summary: Record<string, unknown> }).summary;
    expect(summary.total).toBe(4);
    expect(summary.active).toBe(1);
    expect(summary.pendingResumption).toBe(1);
    expect(summary.resumed).toBe(1);
    expect(summary.cancelled).toBe(1);
  });
});
