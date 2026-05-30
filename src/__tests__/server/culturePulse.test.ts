// Real-router supertest for the Culture Pulse survey endpoints (§61-63 —
// percepción de seguridad + índice de cultura). Mounts the ACTUAL router
// (src/server/routes/culturePulse.ts) through the reusable fakeFirestore, so
// this is genuine coverage of the production handlers (the route had 0 tests).
//
// Focus: the two state-changing POSTs (schedule + respond) — auth, the
// scheduler role-gate, the survey-window enforcement (409 closed/not-open),
// idempotent one-response-per-worker, and the PRIVACY contract: a stored
// response must NEVER carry the responder uid (only the anonymizing hash).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';

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
      role: req.header('x-test-role') || undefined,
      admin: req.header('x-test-admin') === 'true',
    };
    next();
  },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import culturePulseRouter from '../../server/routes/culturePulse.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', culturePulseRouter);
  return app;
}

const PULSE = '/api/sprint-k/p1/culture-pulse';
const PAST = '2020-01-01T00:00:00.000Z';
const PAST2 = '2020-06-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const FUTURE2 = '2999-06-01T00:00:00.000Z';
const CP_COLL = 'tenants/t1/projects/p1/culture_pulse';

function responderHash(uid: string, surveyId: string): string {
  return createHash('sha256').update(`${uid}:${surveyId}`).digest('hex').slice(0, 32);
}

const validAnswers = {
  felt_safe_today: 4,
  manager_listens: 5,
  free_to_stop: 3,
  reported_incident_safely: 4,
  has_resources_to_be_safe: 5,
};

function seedSurvey(id: string, over: Record<string, unknown> = {}) {
  H.db!._seed(`${CP_COLL}/${id}`, {
    id, status: 'open', openAt: PAST, closeAt: FUTURE,
    title: 'Ola 1', createdAt: PAST, createdBy: 'boss', ...over,
  });
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['boss', 'w1'] });
});

describe('POST /culture-pulse/survey (schedule)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .send({ surveyId: 'wv1', openAt: PAST, closeAt: FUTURE });
    expect(res.status).toBe(401);
  });

  it('403 forbidden_role for a worker (no scheduler role)', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'w1')
      .send({ surveyId: 'wv1', openAt: PAST, closeAt: FUTURE });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('201 + status=open when an admin schedules a future-close survey', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'boss')
      .set('x-test-admin', 'true')
      .send({ surveyId: 'wv1', openAt: PAST, closeAt: FUTURE, title: 'Clima Q1' });
    expect(res.status).toBe(201);
    expect(res.body.survey.status).toBe('open');
    expect(res.body.survey.createdBy).toBe('boss');
  });

  it('201 + status=closed when closeAt is already past', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'sup')
      .set('x-test-role', 'supervisor')
      .send({ surveyId: 'wv2', openAt: PAST, closeAt: PAST2 });
    expect(res.status).toBe(201);
    expect(res.body.survey.status).toBe('closed');
  });

  it('409 survey_already_exists', async () => {
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'boss')
      .set('x-test-admin', 'true')
      .send({ surveyId: 'wv1', openAt: PAST, closeAt: FUTURE });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('survey_already_exists');
  });

  it('400 when closeAt is not after openAt (schema refine)', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'boss')
      .set('x-test-admin', 'true')
      .send({ surveyId: 'wv3', openAt: FUTURE, closeAt: PAST });
    expect(res.status).toBe(400);
  });
});

describe('POST /culture-pulse/survey/:id/respond', () => {
  it('401 without a token', async () => {
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(401);
  });

  it('404 when the survey does not exist', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey/ghost/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('survey_not_found');
  });

  it('409 survey_closed when closeAt has passed', async () => {
    seedSurvey('wv1', { status: 'closed', closeAt: PAST2 });
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('survey_closed');
  });

  it('409 survey_not_open when openAt is in the future', async () => {
    seedSurvey('wv1', { openAt: FUTURE, closeAt: FUTURE2 });
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('survey_not_open');
  });

  it('201 on a valid response — and the stored doc is ANONYMOUS (no uid)', async () => {
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(201);
    const hash = responderHash('w1', 'wv1');
    const stored = (
      await H.db!.collection(CP_COLL).doc('wv1').collection('responses').doc(hash).get()
    ).data() as Record<string, unknown>;
    expect(stored).toBeTruthy();
    expect(stored.responderHash).toBe(hash);
    // Privacy invariant: the raw uid must NOT be persisted anywhere on the doc.
    expect(JSON.stringify(stored)).not.toContain('w1');
    expect(stored.answers).toEqual(validAnswers);
  });

  it('409 already_responded on a second submission by the same worker', async () => {
    seedSurvey('wv1');
    H.db!._seed(`${CP_COLL}/wv1/responses/${responderHash('w1', 'wv1')}`, {
      responderHash: responderHash('w1', 'wv1'), workerRole: 'x', area: 'y',
      answers: validAnswers, submittedAt: PAST,
    });
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_responded');
  });

  it('400 when an answer is out of the 1-5 range (schema)', async () => {
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: { ...validAnswers, felt_safe_today: 9 } });
    expect(res.status).toBe(400);
  });
});
