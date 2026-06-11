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
    // Role comes from the VERIFIED token claim in prod (verifyAuth.ts); the
    // test surrogate reads it from a header so each case can pick a role.
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
    };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import stoppageRouter from '../../server/routes/stoppage.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { POINT_VALUES } from '../../services/gamification/pointValues';

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

// ============================================================================
// POST /:projectId/stoppage/resolve — veredicto + premio (arista B4)
// ============================================================================
describe('POST /:projectId/stoppage/resolve', () => {
  const ENDPOINT = `/api/${PROJECT}/stoppage/resolve`;
  const TENANT = 'tenant-1';
  const WORKER_UID = 'uid-worker';
  const SUPERVISOR_UID = 'uid-supervisor';
  const STOPPAGE_ID = 'stop-r1';
  const OBSERVATION_PATH = `tenants/${TENANT}/projects/${PROJECT}/positive_observations/stoppage-justified-${STOPPAGE_ID}`;

  const asRole = (uid: string, role: string) => ({
    'x-test-uid': uid,
    'x-test-role': role,
  });

  /** Closed (resumed) stoppage declared by a worker exercising stop-work authority. */
  function seedResolvedScenario(over: Record<string, unknown> = {}) {
    H.db!._seed(`projects/${PROJECT}`, {
      members: [MEMBER_UID, WORKER_UID, SUPERVISOR_UID],
      createdBy: MEMBER_UID,
      tenantId: TENANT,
    });
    H.db!._seed(`projects/${PROJECT}/stoppages/${STOPPAGE_ID}`, {
      id: STOPPAGE_ID,
      projectId: PROJECT,
      category: 'detencion_voluntaria',
      scope: 'task',
      scopeTargetId: 'task-77',
      reason: 'Andamio sin certificación vigente en el frente de trabajo',
      declaredByUid: WORKER_UID,
      declaredByRole: 'operario',
      declaredAt: new Date('2026-06-01T08:00:00Z').toISOString(),
      status: 'resumed',
      resumedAt: new Date('2026-06-01T15:00:00Z').toISOString(),
      resumedByUid: SUPERVISOR_UID,
      resumptionPreconditions: [
        {
          id: 'pc-1',
          label: 'Andamio recertificado',
          fulfilled: true,
          fulfilledByUid: SUPERVISOR_UID,
          fulfilledAt: new Date('2026-06-01T14:00:00Z').toISOString(),
        },
      ],
      ...over,
    });
  }

  const justifiedBody = {
    stoppageId: STOPPAGE_ID,
    verdict: 'justificada',
    comment: 'Riesgo real verificado: andamio efectivamente sin certificación',
  };

  function auditRows() {
    return Object.entries(H.db!._dump())
      .filter(([k]) => k.startsWith('audit_logs/'))
      .map(([, v]) => v as Record<string, unknown>);
  }

  it('401 without auth token', async () => {
    seedResolvedScenario();
    const res = await request(buildApp()).post(ENDPOINT).send(justifiedBody);
    expect(res.status).toBe(401);
  });

  it('403 for non-member caller (even with supervisor role)', async () => {
    seedResolvedScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(OTHER_UID, 'supervisor'))
      .send(justifiedBody);
    expect(res.status).toBe(403);
  });

  it('403 for member WITHOUT approver role (worker cannot self-grant verdicts)', async () => {
    seedResolvedScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(WORKER_UID, 'operario'))
      .send(justifiedBody);
    expect(res.status).toBe(403);
    // No prize side effects
    expect(H.db!._dump()[OBSERVATION_PATH]).toBeUndefined();
    expect(H.db!._dump()[`user_stats/${WORKER_UID}`]).toBeUndefined();
  });

  it('400 for invalid verdict value', async () => {
    seedResolvedScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(SUPERVISOR_UID, 'supervisor'))
      .send({ ...justifiedBody, verdict: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('404 for unknown stoppageId', async () => {
    seedResolvedScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(SUPERVISOR_UID, 'supervisor'))
      .send({ ...justifiedBody, stoppageId: 'no-such-stoppage' });
    expect(res.status).toBe(404);
  });

  it('400 when stoppage lifecycle is not closed yet (active)', async () => {
    seedResolvedScenario({ status: 'active', resumedAt: undefined, resumedByUid: undefined });
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(SUPERVISOR_UID, 'supervisor'))
      .send(justifiedBody);
    expect(res.status).toBe(400);
  });

  it('200 justificada → resolution persisted + positive observation + XP + audit', async () => {
    seedResolvedScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(SUPERVISOR_UID, 'supervisor'))
      .send(justifiedBody);
    expect(res.status).toBe(200);

    // Resolution persisted on the stoppage doc (server-authoritative).
    const stored = H.db!._dump()[`projects/${PROJECT}/stoppages/${STOPPAGE_ID}`];
    const resolution = stored.resolution as Record<string, unknown>;
    expect(resolution.verdict).toBe('justificada');
    expect(resolution.resolvedByUid).toBe(SUPERVISOR_UID);
    expect(resolution.resolvedByRole).toBe('supervisor');

    // Recognition surfaced in the response.
    const recognition = (res.body as Record<string, any>).recognition;
    expect(recognition).toMatchObject({
      recipientUid: WORKER_UID,
      xpAwarded: POINT_VALUES.stoppage_justified,
      observationId: `stoppage-justified-${STOPPAGE_ID}`,
    });

    // Positive observation written via the canonical adapter path.
    const obs = H.db!._dump()[OBSERVATION_PATH];
    expect(obs).toBeDefined();
    expect(obs.observedWorkerUid).toBe(WORKER_UID);
    expect(obs.observerUid).toBe(SUPERVISOR_UID);
    expect(obs.kind).toBe('safe_behavior');
    expect(String(obs.description)).toContain('Paralización justificada');

    // XP awarded through gamificationBackend.awardPoints (user_stats + history).
    const stats = H.db!._dump()[`user_stats/${WORKER_UID}`];
    expect(stats.points).toBe(POINT_VALUES.stoppage_justified);
    const history = Object.keys(H.db!._dump()).filter((k) =>
      k.startsWith('gamification_history/'),
    );
    expect(history.length).toBe(1);

    // Audit trail (server-stamped actor).
    const rows = auditRows().filter((r) => r.action === 'stoppage.resolve');
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(SUPERVISOR_UID);
    expect(rows[0].projectId).toBe(PROJECT);
    expect((rows[0].details as Record<string, unknown>).verdict).toBe('justificada');
  });

  it('200 no_justificada → resolution persisted, NO prize, audit still written', async () => {
    seedResolvedScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(SUPERVISOR_UID, 'supervisor'))
      .send({ stoppageId: STOPPAGE_ID, verdict: 'no_justificada' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).recognition).toBeNull();
    expect(H.db!._dump()[OBSERVATION_PATH]).toBeUndefined();
    expect(H.db!._dump()[`user_stats/${WORKER_UID}`]).toBeUndefined();
    const rows = auditRows().filter((r) => r.action === 'stoppage.resolve');
    expect(rows.length).toBe(1);
    expect((rows[0].details as Record<string, unknown>).verdict).toBe('no_justificada');
  });

  it('409 on re-resolve — prize is NOT duplicated (idempotency)', async () => {
    seedResolvedScenario();
    const app = buildApp();
    const first = await request(app)
      .post(ENDPOINT)
      .set(asRole(SUPERVISOR_UID, 'supervisor'))
      .send(justifiedBody);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(ENDPOINT)
      .set(asRole(SUPERVISOR_UID, 'supervisor'))
      .send(justifiedBody);
    expect(second.status).toBe(409);
    expect((second.body as Record<string, unknown>).error).toBe('already_resolved');

    // XP awarded exactly once; single observation; single history row.
    const stats = H.db!._dump()[`user_stats/${WORKER_UID}`];
    expect(stats.points).toBe(POINT_VALUES.stoppage_justified);
    const history = Object.keys(H.db!._dump()).filter((k) =>
      k.startsWith('gamification_history/'),
    );
    expect(history.length).toBe(1);
  });

  it('200 justificada but resolver == declarer → no self-award', async () => {
    seedResolvedScenario({ declaredByUid: SUPERVISOR_UID, declaredByRole: 'supervisor' });
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(SUPERVISOR_UID, 'supervisor'))
      .send(justifiedBody);
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).recognition).toBeNull();
    expect(H.db!._dump()[OBSERVATION_PATH]).toBeUndefined();
    expect(H.db!._dump()[`user_stats/${SUPERVISOR_UID}`]).toBeUndefined();
  });
});
