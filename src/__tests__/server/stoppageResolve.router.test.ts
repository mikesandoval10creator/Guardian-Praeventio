// Real-router supertest for src/server/routes/stoppage.ts — STATEFUL endpoints.
// Coverage target: POST /:projectId/stoppage/{resume,resolve} — the two
// server-authoritative handlers that read + write + audit the Firestore
// stoppage doc (resume = signed resumption, arista B8; resolve = veredicto +
// premio, arista B4).
//
// Split from stoppage.router.test.ts on purpose: the CI "Tests" job froze
// 4/4 times with THAT file as the only one never completing (worker stuck,
// pool waiting forever) while it passes everywhere locally (node 20/22,
// CI=true, full suite). Isolating the stateful blocks in their own file
// changes worker scheduling deterministically and, if the hang ever
// returns, the per-file completion log discriminates which half is guilty.
// See PR #841 discussion.

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

const PROJECT = 'proj-alpha';
const MEMBER_UID = 'uid-member';
const OTHER_UID = 'uid-stranger';

beforeEach(() => {
  H.db = createFakeFirestore();
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

// ============================================================================
// POST /:projectId/stoppage/resume — server-authoritative signed resumption
// ============================================================================
//
// The legacy /resume was a STATELESS pure-engine echo that trusted a
// client-supplied `resumedByRole` (any project member could pass
// resumedByRole:'admin' and the engine would accept it), never persisted, and
// never audited. This block pins the hardened contract: role from the verified
// token, mandatory signature attestation, server-side read+write+audit, and
// defence-in-depth re-check of the preconditions.
describe('POST /:projectId/stoppage/resume', () => {
  const ENDPOINT = `/api/${PROJECT}/stoppage/resume`;
  const WORKER_UID = 'uid-worker';
  const STOPPAGE_ID = 'stop-resume-1';
  const STOPPAGE_PATH = `projects/${PROJECT}/stoppages/${STOPPAGE_ID}`;

  const asRole = (uid: string, role: string) => ({
    'x-test-uid': uid,
    'x-test-role': role,
  });

  /** A pending_resumption stoppage with ALL preconditions fulfilled. */
  function seedPendingScenario(over: Record<string, unknown> = {}) {
    H.db!._seed(`projects/${PROJECT}`, {
      members: [MEMBER_UID, WORKER_UID],
      createdBy: MEMBER_UID,
    });
    H.db!._seed(STOPPAGE_PATH, {
      id: STOPPAGE_ID,
      projectId: PROJECT,
      category: 'detencion_voluntaria',
      scope: 'task',
      scopeTargetId: 'task-9',
      reason: 'Riesgo de caída en altura sin protección colectiva',
      declaredByUid: WORKER_UID,
      declaredByRole: 'operario',
      declaredAt: new Date('2026-06-01T08:00:00Z').toISOString(),
      status: 'pending_resumption',
      resumptionPreconditions: [
        {
          id: 'pc-1',
          label: 'Protección colectiva instalada',
          fulfilled: true,
          fulfilledByUid: MEMBER_UID,
          fulfilledAt: new Date('2026-06-01T09:00:00Z').toISOString(),
        },
      ],
      ...over,
    });
  }

  const validBody = {
    stoppageId: STOPPAGE_ID,
    justification:
      'Condiciones verificadas en terreno: protección colectiva instalada y certificada por prevencionista',
    measuresAdopted: ['Línea de vida instalada', 'Inspección por prevencionista'],
    signatureAttested: true,
  };

  function auditResumeRows() {
    return Object.entries(H.db!._dump())
      .filter(([k]) => k.startsWith('audit_logs/'))
      .map(([, v]) => v as Record<string, unknown>)
      .filter((r) => r.action === 'stoppage.resume');
  }
  const storedStoppage = () =>
    H.db!._dump()[STOPPAGE_PATH] as Record<string, unknown>;

  it('401 without auth token', async () => {
    seedPendingScenario();
    const res = await request(buildApp()).post(ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member caller (even with supervisor role)', async () => {
    seedPendingScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(OTHER_UID, 'supervisor'))
      .send(validBody);
    expect(res.status).toBe(403);
    expect(storedStoppage().status).toBe('pending_resumption'); // unchanged
  });

  it('403 for a member WITHOUT approver role — a worker cannot lift a stoppage (authz hole closed)', async () => {
    seedPendingScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(WORKER_UID, 'operario'))
      .send(validBody);
    expect(res.status).toBe(403);
    // The stoppage is NOT resumed and nothing is audited.
    expect(storedStoppage().status).toBe('pending_resumption');
    expect(auditResumeRows().length).toBe(0);
  });

  it('400 for invalid body — missing justification', async () => {
    seedPendingScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send({ ...validBody, justification: undefined });
    expect(res.status).toBe(400);
  });

  it('400 when the biometric signature is not attested — fail-closed', async () => {
    seedPendingScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send({ ...validBody, signatureAttested: false });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('signature_required');
    expect(storedStoppage().status).toBe('pending_resumption');
  });

  it('404 for an unknown stoppageId', async () => {
    seedPendingScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send({ ...validBody, stoppageId: 'no-such-stoppage' });
    expect(res.status).toBe(404);
  });

  it('400 when not all preconditions are fulfilled (defence-in-depth vs spoofed status)', async () => {
    seedPendingScenario({
      resumptionPreconditions: [
        { id: 'pc-1', label: 'Protección colectiva instalada', fulfilled: false },
      ],
    });
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send(validBody);
    expect(res.status).toBe(400);
    expect(storedStoppage().status).toBe('pending_resumption');
  });

  it('200 happy path — status→resumed, uid+role server-stamped, resumption + audit persisted', async () => {
    seedPendingScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send(validBody);
    expect(res.status).toBe(200);
    const s = (res.body as { stoppage: Record<string, any> }).stoppage;
    expect(s.status).toBe('resumed');
    expect(s.resumedByUid).toBe(MEMBER_UID);
    expect(s.resumedByRole).toBe('supervisor');
    expect(typeof s.resumedAt).toBe('string');

    // Persisted server-authoritatively on the doc.
    const stored = storedStoppage();
    expect(stored.status).toBe('resumed');
    expect(stored.resumedByUid).toBe(MEMBER_UID);
    expect(stored.resumedByRole).toBe('supervisor');
    const resumption = stored.resumption as Record<string, unknown>;
    expect(String(resumption.justification)).toContain('Condiciones verificadas');
    expect(resumption.measuresAdopted).toEqual(validBody.measuresAdopted);
    expect(resumption.signatureAttested).toBe(true);
    expect(resumption.resumedByRole).toBe('supervisor');

    // Audit trail (server-stamped actor).
    const rows = auditResumeRows();
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(MEMBER_UID);
    expect(rows[0].projectId).toBe(PROJECT);
    expect((rows[0].details as Record<string, unknown>).resumedByRole).toBe('supervisor');
  });

  it('ignores a client-supplied role/uid in the body — the token claim wins', async () => {
    seedPendingScenario();
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      // Attacker injects a higher role + a different uid; both must be ignored.
      .send({ ...validBody, resumedByRole: 'gerente', resumedByUid: 'uid-elsewhere' });
    expect(res.status).toBe(200);
    const stored = storedStoppage();
    expect(stored.resumedByRole).toBe('supervisor'); // token, NOT body 'gerente'
    expect(stored.resumedByUid).toBe(MEMBER_UID); // token, NOT body
  });

  it('409 on re-resume — idempotent, never double-resumes', async () => {
    seedPendingScenario();
    const app = buildApp();
    const first = await request(app)
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send(validBody);
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(ENDPOINT)
      .set(asRole(MEMBER_UID, 'supervisor'))
      .send(validBody);
    expect(second.status).toBe(409);
    expect((second.body as Record<string, unknown>).error).toBe('already_resumed');
    expect(auditResumeRows().length).toBe(1); // exactly one resume audited
  });
});
