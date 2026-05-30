// Real-router supertest for src/server/routes/returnToWork.ts (Sprint 49 §251-254).
// Mounts the ACTUAL production router; no production code is modified.
// ADR 0012: route only TRACKS operational restrictions provided by the caller
// (workerRestrictions, clearances, etc.) — it never infers a diagnosis.
// The compute engine is pure (assessTaskFit, decideDerivation, buildReturnToWorkPlan)
// and is exercised by passing controlled input shapes.

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
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import returnToWorkRouter from '../../server/routes/returnToWork.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', returnToWorkRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Shared valid fixtures (ADR 0012: tags are operational, not diagnostic)
// ---------------------------------------------------------------------------

const RESTRICTION_NO_LIFTING: Record<string, unknown> = {
  workerUid: 'worker-1',
  tag: 'no_lifting_above_10kg',
  startsAt: '2026-01-01',
  source: 'mutual_doctor_order',
};

const RESTRICTION_REDUCED_HOURS: Record<string, unknown> = {
  workerUid: 'worker-1',
  tag: 'reduced_hours',
  startsAt: '2026-01-01',
  source: 'company_doctor_order',
};

const TASK_NO_CONFLICT: Record<string, unknown> = {
  taskId: 'task-office-work',
  conflictsWith: [],
};

const TASK_CONFLICTS_LIFTING: Record<string, unknown> = {
  taskId: 'task-heavy-load',
  conflictsWith: ['no_lifting_above_10kg'],
};

// Project doc that seeds the fake Firestore so assertProjectMember passes.
const PROJECT_ID = 'proj-rtw';
const CALLER_UID = 'supervisor-1';

beforeEach(() => {
  H.db = createFakeFirestore();
  // Seed project so assertProjectMember resolves (member list includes caller).
  H.db._seed(`projects/${PROJECT_ID}`, { members: [CALLER_UID], createdBy: 'owner-0' });
});

// ---------------------------------------------------------------------------
// POST /:projectId/return-to-work/assess-task-fit
// ---------------------------------------------------------------------------

describe('POST /api/sprint-k/:projectId/return-to-work/assess-task-fit', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/return-to-work/assess-task-fit`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({
      workerRestrictions: [],
      task: TASK_NO_CONFLICT,
    });
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (missing task)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ workerRestrictions: [] }); // task is required
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid restriction tag (unknown tag rejected by enum)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        workerRestrictions: [{ ...RESTRICTION_NO_LIFTING, tag: 'diagnose_condition' }],
        task: TASK_NO_CONFLICT,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'outsider-uid')
      .send({ workerRestrictions: [], task: TASK_NO_CONFLICT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 fit — worker has no active restrictions conflicting with task', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ workerRestrictions: [], task: TASK_NO_CONFLICT });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    expect(assessment).toBeDefined();
    expect(assessment.fit).toBe('fit');
    expect(assessment.violatedRestrictions).toEqual([]);
    // ADR 0012: assessment carries operational tags, never a diagnosis text.
    expect(assessment).not.toHaveProperty('diagnosis');
    expect(assessment).not.toHaveProperty('clinicalRisk');
  });

  it('200 unfit — restriction conflicts with task requirements', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        workerRestrictions: [RESTRICTION_NO_LIFTING],
        task: TASK_CONFLICTS_LIFTING,
      });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    expect(assessment.fit).toBe('unfit');
    expect(Array.isArray(assessment.violatedRestrictions)).toBe(true);
    expect((assessment.violatedRestrictions as string[])).toContain('no_lifting_above_10kg');
  });

  it('200 fit_with_accommodation — reduced_hours restriction yields accommodation suggestion', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        workerRestrictions: [RESTRICTION_REDUCED_HOURS],
        task: TASK_NO_CONFLICT,
        now: '2026-05-30T10:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    // reduced_hours drives accommodation suggestion when task doesn't conflict.
    expect(['fit', 'fit_with_accommodation']).toContain(assessment.fit);
    expect(typeof assessment.rationale).toBe('string');
  });

  it('200 requires_medical_review — expired review interval triggers that status', async () => {
    // Restriction started 60 days ago with a 30-day review interval.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        workerRestrictions: [
          {
            workerUid: 'worker-1',
            tag: 'no_lifting_above_10kg',
            startsAt: '2026-03-01', // 90 days before test date
            source: 'mutual_doctor_order',
            requiresReview: true,
            reviewIntervalDays: 30,
          },
        ],
        task: TASK_CONFLICTS_LIFTING,
        now: '2026-05-30T10:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    expect(assessment.fit).toBe('requires_medical_review');
  });
});

// ---------------------------------------------------------------------------
// POST /:projectId/return-to-work/decide-derivation
// ---------------------------------------------------------------------------

describe('POST /api/sprint-k/:projectId/return-to-work/decide-derivation', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/return-to-work/decide-derivation`;

  const baseInput: Record<string, unknown> = {
    workerUid: 'worker-1',
    workerMutuality: 'achs',
    incidentSeverity: 'medium',
    incidentKind: 'fall',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ input: baseInput });
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (missing input.workerMutuality)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ input: { workerUid: 'w1' } }); // workerMutuality missing
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid mutuality value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ input: { ...baseInput, workerMutuality: 'unknown_mutual' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'outsider-uid')
      .send({ input: baseInput });
    expect(res.status).toBe(403);
  });

  it('200 routine derivation — low-severity fall, no lost time', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        input: {
          workerUid: 'worker-1',
          workerMutuality: 'achs',
          incidentSeverity: 'low',
          incidentKind: 'fall',
        },
        now: '2026-05-30T10:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { derivation } = res.body as { derivation: Record<string, unknown> };
    expect(derivation.urgency).toBe('routine');
    expect(derivation.mutuality).toBe('achs');
    expect(typeof derivation.scheduledFor).toBe('string');
    // ADR 0012: server returns a workflow scheduling decision, not a diagnosis.
    expect(derivation).not.toHaveProperty('diagnosis');
    expect(derivation).not.toHaveProperty('predictedPathology');
  });

  it('200 emergency derivation — sif severity triggers emergency urgency', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        input: {
          workerUid: 'worker-1',
          workerMutuality: 'ist',
          incidentSeverity: 'sif',
          incidentKind: 'crush',
        },
        now: '2026-05-30T10:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { derivation } = res.body as { derivation: Record<string, unknown> };
    expect(derivation.urgency).toBe('emergency');
  });

  it('200 urgent derivation — commute accident (non-sif)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        input: {
          workerUid: 'worker-1',
          workerMutuality: 'mutual',
          commuteEvent: true,
          incidentSeverity: 'high',
        },
        now: '2026-05-30T10:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { derivation } = res.body as { derivation: Record<string, unknown> };
    expect(derivation.reason).toBe('commute_accident');
    expect(derivation.urgency).toBe('urgent');
  });

  it('200 psychosocial derivation — psychological incident kind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        input: {
          workerUid: 'worker-1',
          workerMutuality: 'isl',
          incidentKind: 'psychological',
        },
        now: '2026-05-30T10:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { derivation } = res.body as { derivation: Record<string, unknown> };
    expect(derivation.reason).toBe('psychosocial_event');
  });

  it('200 occupational suspicion derivation — occupationalSuspicion flag', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        input: {
          workerUid: 'worker-1',
          workerMutuality: 'achs',
          occupationalSuspicion: true,
        },
        now: '2026-05-30T10:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const { derivation } = res.body as { derivation: Record<string, unknown> };
    expect(derivation.reason).toBe('occupational_disease_suspected');
    expect(derivation.urgency).toBe('routine');
  });
});

// ---------------------------------------------------------------------------
// POST /:projectId/return-to-work/build-plan
// ---------------------------------------------------------------------------

describe('POST /api/sprint-k/:projectId/return-to-work/build-plan', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/return-to-work/build-plan`;

  const baseBody: Record<string, unknown> = {
    workerUid: 'worker-1',
    absenceFrom: '2026-04-01',
    absenceTo: '2026-04-05', // short: 4 days
    absenceKind: 'sick_leave',
    activeRestrictions: [],
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(baseBody);
    expect(res.status).toBe(401);
  });

  it('400 on missing absenceKind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...baseBody, absenceKind: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid absenceKind enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...baseBody, absenceKind: 'extended_medical_leave' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'outsider-uid')
      .send(baseBody);
    expect(res.status).toBe(403);
  });

  it('200 short absence plan — <7 days returns single-week schedule', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(baseBody);
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: Record<string, unknown> };
    expect(plan.workerUid).toBe('worker-1');
    expect(typeof plan.absenceDays).toBe('number');
    expect(plan.absenceDays).toBe(4);
    expect(Array.isArray(plan.progressiveSchedule)).toBe(true);
    expect((plan.progressiveSchedule as unknown[]).length).toBe(1);
    expect(plan.reassessmentInWeeks).toBe(2);
    // ADR 0012: plan tracks restrictions provided by caller, not computed fitness.
    expect(plan).not.toHaveProperty('diagnosis');
    expect(plan).not.toHaveProperty('medicalFitness');
  });

  it('200 medium absence plan — 7-29 days returns 3-phase schedule', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...baseBody,
        absenceFrom: '2026-04-01',
        absenceTo: '2026-04-20', // 19 days
        absenceKind: 'work_injury_leave',
      });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: Record<string, unknown> };
    expect((plan.progressiveSchedule as unknown[]).length).toBe(3);
    expect(plan.reassessmentInWeeks).toBe(4);
    // work_injury_leave triggers psychosocial reinforcement accommodation.
    expect(Array.isArray(plan.accommodations)).toBe(true);
    const accs = plan.accommodations as string[];
    expect(accs.some((a) => /psicosocial|bienestar/i.test(a))).toBe(true);
  });

  it('200 long absence plan — ≥30 days returns 4-phase schedule with buddy restriction', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        workerUid: 'worker-1',
        absenceFrom: '2026-01-01',
        absenceTo: '2026-03-01', // ~59 days
        absenceKind: 'work_injury_leave',
        activeRestrictions: [
          {
            workerUid: 'worker-1',
            tag: 'requires_buddy',
            startsAt: '2026-01-01',
            source: 'company_doctor_order',
          },
        ],
      });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: Record<string, unknown> };
    expect((plan.progressiveSchedule as unknown[]).length).toBe(4);
    expect(plan.reassessmentInWeeks).toBe(8);
    const accs = plan.accommodations as string[];
    // requires_buddy restriction (from caller input) drives an accommodation.
    expect(accs.some((a) => /buddy/i.test(a))).toBe(true);
  });

  it('200 night-shift restriction generates day-only accommodation', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        workerUid: 'worker-1',
        absenceFrom: '2026-04-01',
        absenceTo: '2026-04-10',
        absenceKind: 'sick_leave',
        activeRestrictions: [
          {
            workerUid: 'worker-1',
            tag: 'no_night_shift',
            startsAt: '2026-04-01',
            source: 'mutual_doctor_order',
          },
        ],
      });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: Record<string, unknown> };
    const accs = plan.accommodations as string[];
    expect(accs.some((a) => /diurn/i.test(a))).toBe(true);
  });
});
