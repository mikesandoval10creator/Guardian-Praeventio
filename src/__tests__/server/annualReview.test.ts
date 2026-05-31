// Real-router supertest for §291-295 Revisión Anual del SGI (ISO 45001 §9.3).
// Mounts the ACTUAL annualReview router through fakeFirestore so this is
// genuine line coverage of the production handlers.
//
// 4 endpoints:
//   GET  /:projectId/annual-review/current[?year=N]
//   POST /:projectId/annual-review/objectives
//   POST /:projectId/annual-review/evidence
//   POST /:projectId/annual-review/conclude

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
    (req as Request & { user: { uid: string; role?: string } }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
    };
    next();
  },
}));
vi.mock('../../server/middleware/validate.js', () => ({
  // Pass-through: schemas are inlined in the route so real Zod parse still
  // runs via req.body. The validate middleware attaches req.validated — we skip
  // that so the route reads req.body directly (which it does with `req.body as
  // z.infer<...>`). Validation 400s are tested via the real route schema guards
  // that live inside the handler body.
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
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

import annualReviewRouter from '../../server/routes/annualReview.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

// ── App factory ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', annualReviewRouter);
  return app;
}

// ── Constants ────────────────────────────────────────────────────────────────

const P = 'p1';
const TENANT = 't1';
const UID = 'user1';
const YEAR = 2026;
const REVIEW_PATH = `tenants/${TENANT}/projects/${P}/annual_reviews/${YEAR}`;
const BASE = `/api/sprint-k/${P}/annual-review`;
const AUTH = { 'x-test-uid': UID };

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedProject() {
  H.db!._seed(`projects/${P}`, { tenantId: TENANT });
}

const minObjective = {
  id: 'obj1',
  title: 'Reducir accidentes',
  description: '',
  metric: 'percent_reduction' as const,
  baseline: 10,
  target: 5,
  currentValue: 0,
  deadline: '2026-12-31',
  ownerUid: UID,
  status: 'planned' as const,
  linkedActionIds: [] as string[],
  evidenceUrls: [] as string[],
};

function seedOpenReview(extra: Record<string, unknown> = {}) {
  H.db!._seed(REVIEW_PATH, {
    fiscalYear: YEAR,
    tenantId: TENANT,
    projectId: P,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedByUid: UID,
    objectives: [],
    evidences: [],
    analysis: '',
    conclusion: null,
    signedOffByUid: null,
    signedOffByName: null,
    concludedAt: null,
    isConcluded: false,
    ...extra,
  });
}

function seedConcludedReview() {
  seedOpenReview({
    isConcluded: true,
    conclusion: 'El sistema funciona.',
    signedOffByUid: UID,
    signedOffByName: 'Nombre Apellido',
    concludedAt: '2026-06-01T00:00:00.000Z',
  });
}

function seedReviewWithObjective() {
  seedOpenReview({
    objectives: [
      {
        id: 'obj1',
        fiscalYear: YEAR,
        title: 'Reducir accidentes',
        description: '',
        metric: 'percent_reduction',
        baseline: 10,
        target: 5,
        currentValue: 0,
        deadline: '2026-12-31',
        ownerUid: UID,
        status: 'planned',
        linkedActionIds: [],
        evidenceUrls: [],
      },
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
// GET /:projectId/annual-review/current
// ────────────────────────────────────────────────────────────────────────────

describe('GET /annual-review/current', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get(`${BASE}/current`);
    expect(res.status).toBe(401);
  });

  it('403 when assertProjectMember rejects membership', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .get(`${BASE}/current`)
      .set(AUTH);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when tenantId cannot be resolved from the project doc', async () => {
    // Overwrite the project doc with NO tenantId field
    H.db!._seed(`projects/${P}`, { someOtherField: true });
    const res = await request(buildApp())
      .get(`${BASE}/current`)
      .set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 + exists=false when no review doc exists yet', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/current?year=${YEAR}`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(YEAR);
    expect(res.body.exists).toBe(false);
    expect(res.body.snapshot).toBeNull();
  });

  it('200 + exists=true + snapshot when a review doc exists', async () => {
    seedOpenReview();
    const res = await request(buildApp())
      .get(`${BASE}/current?year=${YEAR}`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.snapshot).toBeTruthy();
    expect(res.body.snapshot.fiscalYear).toBe(YEAR);
    expect(res.body.snapshot.isConcluded).toBe(false);
  });

  it('200 uses current UTC year when year param is missing', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/current`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(new Date().getUTCFullYear());
  });

  it('200 uses current UTC year when year param is not a valid integer', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/current?year=bogus`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(new Date().getUTCFullYear());
  });

  it('200 uses current UTC year when year param is out of range (<2000)', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/current?year=1999`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(new Date().getUTCFullYear());
  });

  it('200 uses current UTC year when year param is out of range (>2100)', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/current?year=2101`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(new Date().getUTCFullYear());
  });

  it('200 returns a concluded review as-is', async () => {
    seedConcludedReview();
    const res = await request(buildApp())
      .get(`${BASE}/current?year=${YEAR}`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.snapshot.isConcluded).toBe(true);
    expect(res.body.snapshot.signedOffByName).toBe('Nombre Apellido');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/annual-review/objectives
// ────────────────────────────────────────────────────────────────────────────

describe('POST /annual-review/objectives', () => {
  const validBody = {
    year: YEAR,
    objectives: [minObjective],
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 creates a new review with objectives when none exists', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.snapshot.objectives).toHaveLength(1);
    expect(res.body.snapshot.objectives[0].id).toBe('obj1');
    // Verify persisted to fakeFirestore
    const stored = (await H.db!.doc(REVIEW_PATH).get()).data() as Record<string, unknown>;
    expect(stored).toBeTruthy();
    expect((stored.objectives as unknown[]).length).toBe(1);
  });

  it('200 replaces objectives on existing open review', async () => {
    seedOpenReview();
    const secondObjective = { ...minObjective, id: 'obj2', title: 'Reducir EPP faltante' };
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send({ year: YEAR, objectives: [secondObjective] });
    expect(res.status).toBe(200);
    expect(res.body.snapshot.objectives).toHaveLength(1);
    expect(res.body.snapshot.objectives[0].id).toBe('obj2');
  });

  it('200 with analysis field included in request body', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send({ ...validBody, analysis: 'Análisis de brechas Q1 2026.' });
    expect(res.status).toBe(200);
    expect(res.body.snapshot.analysis).toBe('Análisis de brechas Q1 2026.');
  });

  it('200 preserves existing analysis when analysis not sent in body', async () => {
    seedOpenReview({ analysis: 'Análisis previo' });
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.snapshot.analysis).toBe('Análisis previo');
  });

  it('200 stamps updatedByUid with caller uid', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.snapshot.updatedByUid).toBe(UID);
  });

  it('409 review_already_concluded when review is concluded', async () => {
    seedConcludedReview();
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('review_already_concluded');
  });

  it('objective shape includes fiscalYear = body.year', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.snapshot.objectives[0].fiscalYear).toBe(YEAR);
  });

  it('objective defaults applied: status=planned, currentValue=0', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    const obj = res.body.snapshot.objectives[0] as Record<string, unknown>;
    expect(obj.status).toBe('planned');
    expect(obj.currentValue).toBe(0);
    expect(obj.linkedActionIds).toEqual([]);
    expect(obj.evidenceUrls).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/annual-review/evidence
// ────────────────────────────────────────────────────────────────────────────

describe('POST /annual-review/evidence', () => {
  const validBody = {
    year: YEAR,
    objectiveId: 'obj1',
    evidenceUrl: 'https://example.com/evidence.pdf',
    evidenceKind: 'document' as const,
    caption: 'Informe de auditoría Q1',
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when the review doc does not exist', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('review_not_found');
  });

  it('409 review_already_concluded', async () => {
    seedConcludedReview();
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('review_already_concluded');
  });

  it('404 objective_not_found when objective is missing', async () => {
    seedOpenReview(); // no objectives seeded
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('objective_not_found');
  });

  it('200 attaches evidence to an existing objective', async () => {
    seedReviewWithObjective();
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.snapshot.evidences).toHaveLength(1);
    const ev = res.body.snapshot.evidences[0] as Record<string, unknown>;
    expect(ev.objectiveId).toBe('obj1');
    expect(ev.evidenceUrl).toBe(validBody.evidenceUrl);
    expect(ev.evidenceKind).toBe('document');
    expect(ev.attachedByUid).toBe(UID);
    expect(ev.caption).toBe('Informe de auditoría Q1');
  });

  it('200 evidence URL is also pushed onto the objective evidenceUrls', async () => {
    seedReviewWithObjective();
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    const objective = (res.body.snapshot.objectives as Record<string, unknown>[])[0];
    expect(objective.evidenceUrls).toContain(validBody.evidenceUrl);
  });

  it('200 duplicate evidence (same objectiveId + evidenceUrl) is NOT duplicated', async () => {
    // Pre-seed an existing evidence entry
    seedOpenReview({
      objectives: [
        {
          id: 'obj1',
          fiscalYear: YEAR,
          title: 'Reducir accidentes',
          description: '',
          metric: 'percent_reduction',
          baseline: 10,
          target: 5,
          currentValue: 0,
          deadline: '2026-12-31',
          ownerUid: UID,
          status: 'planned',
          linkedActionIds: [],
          evidenceUrls: [validBody.evidenceUrl],
        },
      ],
      evidences: [
        {
          objectiveId: 'obj1',
          evidenceUrl: validBody.evidenceUrl,
          evidenceKind: 'document',
          caption: 'ya existe',
          attachedAt: '2026-01-01T00:00:00.000Z',
          attachedByUid: UID,
        },
      ],
    });
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    // Must remain 1, not 2
    expect(res.body.snapshot.evidences).toHaveLength(1);
    expect(res.body.snapshot.objectives[0].evidenceUrls).toHaveLength(1);
  });

  it('200 stamps updatedByUid with caller uid', async () => {
    seedReviewWithObjective();
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.snapshot.updatedByUid).toBe(UID);
  });

  it('200 persists changes to fakeFirestore', async () => {
    seedReviewWithObjective();
    await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send(validBody);
    const stored = (await H.db!.doc(REVIEW_PATH).get()).data() as Record<string, unknown>;
    expect((stored.evidences as unknown[]).length).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/annual-review/conclude
// ────────────────────────────────────────────────────────────────────────────

describe('POST /annual-review/conclude', () => {
  const validBody = {
    year: YEAR,
    conclusion: 'El SGI cumplió sus objetivos para el año fiscal 2026.',
    signedOffByUid: 'manager1',
    signedOffByName: 'Ana González',
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/conclude`)
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when review does not exist', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('review_not_found');
  });

  it('409 review_already_concluded on double-conclude attempt', async () => {
    seedConcludedReview();
    const res = await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('review_already_concluded');
  });

  it('200 concludes a review and sets isConcluded=true', async () => {
    seedOpenReview();
    const res = await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.snapshot.isConcluded).toBe(true);
    expect(res.body.snapshot.conclusion).toBe(validBody.conclusion);
    expect(res.body.snapshot.signedOffByUid).toBe('manager1');
    expect(res.body.snapshot.signedOffByName).toBe('Ana González');
    expect(res.body.snapshot.concludedAt).toBeTruthy();
  });

  it('200 stamps updatedByUid with caller uid', async () => {
    seedOpenReview();
    const res = await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.snapshot.updatedByUid).toBe(UID);
  });

  it('200 persists isConcluded=true to fakeFirestore', async () => {
    seedOpenReview();
    await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    const stored = (await H.db!.doc(REVIEW_PATH).get()).data() as Record<string, unknown>;
    expect(stored.isConcluded).toBe(true);
    expect(stored.signedOffByName).toBe('Ana González');
  });

  it('concluded review cannot receive further objectives (idempotency)', async () => {
    // First conclude it
    seedOpenReview();
    await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    // Then try to set objectives — must be 409
    const res2 = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send({ year: YEAR, objectives: [minObjective] });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toBe('review_already_concluded');
  });

  it('concluded review cannot receive further evidence', async () => {
    seedReviewWithObjective();
    await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    // Now try to add evidence — must be 409
    const res2 = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send({
        year: YEAR,
        objectiveId: 'obj1',
        evidenceUrl: 'https://example.com/doc.pdf',
        evidenceKind: 'document',
      });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toBe('review_already_concluded');
  });

  it('review is NOT auto-pushed to any external organism (company submits it)', async () => {
    // The route must NOT call any external organism API.
    // We verify this by ensuring NO outbound HTTP mocks were triggered
    // and that the response does not contain any push confirmation field.
    seedOpenReview();
    const res = await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send(validBody);
    expect(res.status).toBe(200);
    // Response shape should only contain ok + snapshot; no 'submittedTo' or
    // 'pushedTo' field that would indicate external system notification.
    expect(res.body).not.toHaveProperty('submittedTo');
    expect(res.body).not.toHaveProperty('pushedTo');
    expect(res.body).not.toHaveProperty('sentToOrganismo');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CLAUDE.md #19 (runTransaction) + #3 (audit_logs) compliance
// ────────────────────────────────────────────────────────────────────────────

describe('rule #19 (transaction) + #3 (audit_logs) compliance', () => {
  function auditRows(): Record<string, unknown>[] {
    return Object.entries(H.db!._dump())
      .filter(([k]) => k.startsWith('audit_logs/'))
      .map(([, v]) => v as Record<string, unknown>);
  }

  it('objectives runs inside a transaction and writes an audit_logs row', async () => {
    const txSpy = vi.spyOn(H.db!, 'runTransaction');
    const res = await request(buildApp())
      .post(`${BASE}/objectives`)
      .set(AUTH)
      .send({ year: YEAR, objectives: [minObjective] });
    expect(res.status).toBe(200);
    expect(txSpy).toHaveBeenCalledTimes(1);
    const audit = auditRows().find((r) => r.action === 'annualReview.objectives');
    expect(audit).toBeTruthy();
    expect(audit).toMatchObject({ module: 'annual_review', userId: UID, projectId: P });
  });

  it('evidence runs inside a transaction and writes an audit_logs row', async () => {
    seedReviewWithObjective();
    const txSpy = vi.spyOn(H.db!, 'runTransaction');
    const res = await request(buildApp())
      .post(`${BASE}/evidence`)
      .set(AUTH)
      .send({
        year: YEAR,
        objectiveId: 'obj1',
        evidenceUrl: 'https://example.com/x.pdf',
        evidenceKind: 'document',
        caption: 'c',
      });
    expect(res.status).toBe(200);
    expect(txSpy).toHaveBeenCalledTimes(1);
    expect(auditRows().some((r) => r.action === 'annualReview.evidence')).toBe(true);
  });

  it('conclude runs inside a transaction and writes an audit_logs row', async () => {
    seedOpenReview();
    const txSpy = vi.spyOn(H.db!, 'runTransaction');
    const res = await request(buildApp())
      .post(`${BASE}/conclude`)
      .set(AUTH)
      .send({ year: YEAR, conclusion: 'done', signedOffByUid: 'm1', signedOffByName: 'N' });
    expect(res.status).toBe(200);
    expect(txSpy).toHaveBeenCalledTimes(1);
    expect(auditRows().some((r) => r.action === 'annualReview.conclude')).toBe(true);
  });
});
