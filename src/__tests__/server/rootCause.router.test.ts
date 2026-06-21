// Real-router supertest for the Root Cause classifier HTTP surface
// (src/server/routes/rootCause.ts). Five stateless POST endpoints over the pure
// engines in services/rootCause/{rootCauseClassifier,noBlameInvestigation}. No
// Firestore writes — the only Firestore I/O is the real `assertProjectMember`
// membership read, which we back with the fakeFirestore (seeding projects/p1
// with members[]). verifyAuth is mocked to the standard test shape; the engines
// are NOT mocked so we assert their real output (and would catch a regression).
//
// Coverage per route: 401 (no token), 200 happy (real engine output), 400
// (invalid body via the Zod validate() barrier), 403 (caller not a project
// member — real assertProjectMember rejects).

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
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import rootCauseRouter from '../../server/routes/rootCause.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', rootCauseRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// Body that passes the build-analysis Zod schema AND the engine validation.
const validBuildBody = {
  incidentId: 'inc-1',
  factors: ['falla_procedimiento', 'falla_supervision'],
  primaryFactor: 'falla_procedimiento',
  fiveWhys: ['El procedimiento estaba desactualizado y nadie lo revisó'],
  suggestedActions: ['Revisar y reentrenar el procedimiento de bloqueo'],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // u1 IS a member of p1 → real assertProjectMember resolves. Other tests can
  // override membership by NOT seeding the doc / omitting u1 from members[].
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
});

describe('POST /:projectId/root-cause/build-analysis', () => {
  const url = '/api/sprint-k/p1/root-cause/build-analysis';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(validBuildBody);
    expect(res.status).toBe(401);
  });

  it('200 returns the real analysis (analyzedByUid forced to caller, factors deduped)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBuildBody, factors: ['falla_procedimiento', 'falla_procedimiento', 'falla_supervision'] });
    expect(res.status).toBe(200);
    expect(res.body.analysis.incidentId).toBe('inc-1');
    // analyzedByUid is stamped from the token, never trusted from the body.
    expect(res.body.analysis.analyzedByUid).toBe('u1');
    // Engine dedupes factors[].
    expect(res.body.analysis.factors).toEqual(['falla_procedimiento', 'falla_supervision']);
    expect(res.body.analysis.primaryFactor).toBe('falla_procedimiento');
    // analyzedAt is a real ISO timestamp produced by the engine.
    expect(() => new Date(res.body.analysis.analyzedAt).toISOString()).not.toThrow();
    expect(res.body.analysis.analyzedAt).toBe(new Date(res.body.analysis.analyzedAt).toISOString());
  });

  it('honors caller-supplied `now` deterministically', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBuildBody, now: '2026-01-02T03:04:05.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.analysis.analyzedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('400 on invalid body (empty factors fails the Zod barrier)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBuildBody, factors: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on unknown factor enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBuildBody, primaryFactor: 'no_such_factor' });
    expect(res.status).toBe(400);
  });

  it('400 from the engine when primaryFactor is not in factors[]', async () => {
    // Schema allows it (both are valid enum members), but the engine rejects.
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBuildBody, factors: ['falla_supervision'], primaryFactor: 'falla_procedimiento' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('PRIMARY_NOT_IN_FACTORS');
  });

  it('403 when the caller is not a member of the project', async () => {
    H.db!._seed('projects/p1', { members: ['someone-else'], createdBy: 'owner' });
    const res = await request(buildApp()).post(url).set(uid).send(validBuildBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/root-cause/compute-stats', () => {
  const url = '/api/sprint-k/p1/root-cause/compute-stats';

  const analysis = (primary: string, factors: string[]) => ({
    incidentId: `inc-${primary}`,
    factors,
    primaryFactor: primary,
    fiveWhys: ['cadena de porqués'],
    analyzedByUid: 'u1',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    suggestedActions: ['accion'],
  });

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ analyses: [] });
    expect(res.status).toBe(401);
  });

  it('200 computes real aggregate stats (counts + top primary factors + percent)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        analyses: [
          analysis('falla_procedimiento', ['falla_procedimiento', 'falla_supervision']),
          analysis('falla_procedimiento', ['falla_procedimiento']),
          analysis('falla_epp', ['falla_epp']),
          analysis('falla_supervision', ['falla_supervision']),
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.stats.totalAnalyses).toBe(4);
    expect(res.body.stats.countByFactor.falla_procedimiento).toBe(2);
    expect(res.body.stats.countByFactor.falla_supervision).toBe(2);
    expect(res.body.stats.countByFactor.falla_epp).toBe(1);
    // Top primary factor is falla_procedimiento (2 of 4 = 50%).
    expect(res.body.stats.topPrimaryFactors[0]).toEqual({
      factor: 'falla_procedimiento',
      count: 2,
      percentOfTotal: 50,
    });
    expect(res.body.stats.topPrimaryFactors).toHaveLength(3);
  });

  it('200 with empty analyses returns zeroed stats (honest empty, not fabricated)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ analyses: [] });
    expect(res.status).toBe(200);
    expect(res.body.stats.totalAnalyses).toBe(0);
    expect(res.body.stats.topPrimaryFactors).toEqual([]);
    expect(res.body.stats.countByFactor.falla_procedimiento).toBe(0);
  });

  it('400 when analyses is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ analyses: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a member of the project', async () => {
    H.db!._seed('projects/p1', { members: ['someone-else'], createdBy: 'owner' });
    const res = await request(buildApp()).post(url).set(uid).send({ analyses: [] });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/root-cause/analyze-punitive-language', () => {
  const url = '/api/sprint-k/p1/root-cause/analyze-punitive-language';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ text: 'x' });
    expect(res.status).toBe(401);
  });

  it('200 flags punitive language and recommends a rewrite', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ text: 'Fue culpa del trabajador por negligencia.' });
    expect(res.status).toBe(200);
    expect(res.body.report.needsRewrite).toBe(true);
    expect(res.body.report.flaggedPhrases.length).toBeGreaterThanOrEqual(2);
    expect(res.body.report.suggestions.length).toBeGreaterThanOrEqual(2);
  });

  it('200 on neutral text reports no rewrite needed (no fabricated flags)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ text: 'El procedimiento de bloqueo no estaba disponible en la zona.' });
    expect(res.status).toBe(200);
    expect(res.body.report.needsRewrite).toBe(false);
    expect(res.body.report.flaggedPhrases).toEqual([]);
    expect(res.body.report.suggestions).toEqual([]);
  });

  it('400 when text is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a member of the project', async () => {
    H.db!._seed('projects/p1', { members: ['someone-else'], createdBy: 'owner' });
    const res = await request(buildApp()).post(url).set(uid).send({ text: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/root-cause/get-investigation-questions', () => {
  const url = '/api/sprint-k/p1/root-cause/get-investigation-questions';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ dimension: 'procedure' });
    expect(res.status).toBe(401);
  });

  it('200 returns only the questions for the requested dimension', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ dimension: 'procedure' });
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBeGreaterThan(0);
    expect(res.body.questions.every((q: { dimension: string }) => q.dimension === 'procedure')).toBe(true);
    expect(res.body.questions[0]).toHaveProperty('question');
    expect(res.body.questions[0]).toHaveProperty('rationale');
  });

  it('200 with an unknown dimension returns an empty list (honest empty)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ dimension: 'unknown-dim' });
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([]);
  });

  it('400 when dimension is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a member of the project', async () => {
    H.db!._seed('projects/p1', { members: ['someone-else'], createdBy: 'owner' });
    const res = await request(buildApp()).post(url).set(uid).send({ dimension: 'procedure' });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/root-cause/get-starter-questionnaire', () => {
  const url = '/api/sprint-k/p1/root-cause/get-starter-questionnaire';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({});
    expect(res.status).toBe(401);
  });

  it('200 returns one question per dimension (deduped starter set)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(200);
    const dims = (res.body.questions as Array<{ dimension: string }>).map((q) => q.dimension);
    // One question per distinct dimension — no dimension repeated.
    expect(new Set(dims).size).toBe(dims.length);
    expect(dims).toContain('procedure');
    expect(dims).toContain('communication');
  });

  it('400 on unexpected body keys (strict empty schema)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ extra: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a member of the project', async () => {
    H.db!._seed('projects/p1', { members: ['someone-else'], createdBy: 'owner' });
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(403);
  });
});
