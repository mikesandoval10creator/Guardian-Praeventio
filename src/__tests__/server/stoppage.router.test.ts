// Real-router supertest for src/server/routes/stoppage.ts — non-doc-mutating endpoints.
// Coverage target: POST /:projectId/stoppage/{declare,mark-precondition-fulfilled,cancel,summarize}
// (/resume and /resolve are server-authoritative — they READ+WRITE the Firestore
//  stoppage doc inside a transaction — and live in stoppageResolve.router.test.ts;
//  the split is deliberate, see that file's header.)
// declare + mark-precondition are pure-engine calls (the client persists the
// returned stoppage) but DO write audit_logs (CLAUDE.md #3) and derive identity
// from the token: declare stamps declaredByUid + declaredByRole from the verified
// token (never the body) and mints the id server-side; mark stamps verifierUid.

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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', stoppageRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const asRole = (uid: string, role: string) => ({ 'x-test-uid': uid, 'x-test-role': role });
const PROJECT = 'proj-alpha';
const MEMBER_UID = 'uid-member';
const OTHER_UID = 'uid-stranger';

function auditRows(action: string) {
  return Object.entries(H.db!._dump())
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v as Record<string, unknown>)
    .filter((r) => r.action === action);
}

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

  // No id and no declaredByRole in the body — both are server-stamped.
  const validBody = {
    category: 'incidente_grave',
    scope: 'zone',
    scopeTargetId: 'zone-42',
    reason: 'Grave riesgo detectado en la zona de excavación',
    resumptionPreconditions: [
      { id: 'pc-1', label: 'Inspección completada' },
    ],
  };

  it('401 without auth token', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 for non-member caller (even with an approver role)', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(OTHER_UID, 'supervisor'))
      .send(validBody);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('400 for invalid body (missing required field)', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send({ ...validBody, category: undefined });
    expect(res.status).toBe(400);
  });

  it('400 for empty resumptionPreconditions array', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send({ ...validBody, resumptionPreconditions: [] });
    expect(res.status).toBe(400);
  });

  it('200 happy path — id + role server-stamped, audited', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send(validBody);
    expect(res.status).toBe(200);
    const s = (res.body as { stoppage: Record<string, unknown> }).stoppage;
    expect(typeof s.id).toBe('string'); // server-minted (no client id in body)
    expect((s.id as string).length).toBeGreaterThan(0);
    expect(s.projectId).toBe(PROJECT);
    expect(s.status).toBe('active');
    expect(s.declaredByUid).toBe(MEMBER_UID);
    expect(s.declaredByRole).toBe('supervisor'); // from the token
    expect(Array.isArray(s.resumptionPreconditions)).toBe(true);

    // Audit trail with the server-stamped actor (CLAUDE.md #3).
    const rows = auditRows('stoppage.declare');
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(MEMBER_UID);
    expect(rows[0].projectId).toBe(PROJECT);
    expect((rows[0].details as Record<string, unknown>).declaredByRole).toBe('supervisor');
  });

  it('400 from engine — reason too short triggers StoppageValidationError → 400', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send({ ...validBody, reason: 'short' });
    expect(res.status).toBe(400);
  });

  it('400 — a non-approver TOKEN role cannot declare a non-voluntary category (authz hole closed)', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'operario'))
      .send(validBody); // incidente_grave
    expect(res.status).toBe(400);
    expect(auditRows('stoppage.declare').length).toBe(0); // nothing declared/audited
  });

  it('body-supplied declaredByRole CANNOT escalate — the token role governs', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'operario'))
      // Attacker tries to fake an approver-level declare of a serious incident.
      .send({ ...validBody, declaredByRole: 'admin' });
    expect(res.status).toBe(400); // token 'operario' still can't declare incidente_grave
  });

  it('200 — detencion_voluntaria allows any role; id + role still server-stamped (body ignored)', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'operario'))
      .send({
        ...validBody,
        category: 'detencion_voluntaria',
        declaredByRole: 'admin', // ignored
        id: 'attacker-chosen-id', // ignored
      });
    expect(res.status).toBe(200);
    const s = (res.body as { stoppage: Record<string, unknown> }).stoppage;
    expect(s.category).toBe('detencion_voluntaria');
    expect(s.declaredByRole).toBe('operario'); // token, NOT body 'admin'
    expect(s.id).not.toBe('attacker-chosen-id'); // server-minted
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

  it('200 happy path — precondition marked fulfilled (verifierUid=token), status → pending_resumption, audited', async () => {
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
    expect(pcs[0].fulfilledByUid).toBe(MEMBER_UID); // server-stamped, not client

    // Audit trail (CLAUDE.md #3) with the server-stamped actor.
    const rows = auditRows('stoppage.markPrecondition');
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(MEMBER_UID);
    expect((rows[0].details as Record<string, unknown>).preconditionId).toBe('pc-1');
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
