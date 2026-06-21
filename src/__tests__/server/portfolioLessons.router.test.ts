// Real-router supertest for the Portfolio Lessons Engine HTTP surface
// (src/server/routes/portfolioLessons.ts). Two stateless POST endpoints over
// the pure engine in src/services/portfolioLessons/portfolioLessonsEngine.ts:
//
//   POST /:projectId/portfolio-lessons/recommend  → { recommendations }
//   POST /:projectId/portfolio-lessons/summarize  → { summary }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine runs UNMOCKED so every 200 asserts real deterministic scoring.
//
// The expected matchScores / reasons / summary below are captured from the REAL
// engine for the fixed input fixtures — they pin actual output rather than
// reimplementing the scoring (industry +40, size +20, kind +10, sim*30,
// sif/critical +10 / high +5, tag overlap +5/tag up to +20).

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
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import portfolioLessonsRouter from '../../server/routes/portfolioLessons.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type { LessonRecord } from '../../services/portfolioLessons/portfolioLessonsEngine.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', portfolioLessonsRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// Fixtures. L1 (srcA) is a critical mining/large/expansion incident overlapping
// the target on industry, size, kind, a tag, and risk-similarity → full score.
// L2 (srcB) only earns the similarity bonus. L3-self shares sourceProjectId with
// the target project (p1) → the engine excludes it ("a project can't teach
// itself"). All three count toward the portfolio summary.
const L1: LessonRecord = {
  id: 'L1',
  sourceProjectId: 'srcA',
  title: 'Caida de altura en andamio',
  category: 'incident',
  applicableIndustries: ['mineria'],
  applicableSizes: ['large'],
  applicableProjectKinds: ['expansion'],
  capturedAt: '2025-01-01',
  tags: ['altura', 'andamio'],
  originalSeverity: 'critical',
  estimatedTransferValueClp: 5_000_000,
};
const L2: LessonRecord = {
  id: 'L2',
  sourceProjectId: 'srcB',
  title: 'Buena practica de charla 5 min',
  category: 'good_practice',
  applicableIndustries: ['construccion'],
  applicableSizes: ['small'],
  capturedAt: '2025-02-01',
  tags: ['cultura'],
};
const L3_SELF: LessonRecord = {
  id: 'L3-self',
  sourceProjectId: 'p1', // == target projectId → filtered out by the engine
  title: 'No se ensena a si mismo',
  category: 'efficiency',
  applicableIndustries: ['mineria'],
  applicableSizes: ['large'],
  capturedAt: '2025-03-01',
  tags: [],
};

const targetContext = {
  projectId: 'p1',
  industry: 'mineria',
  size: 'large' as const,
  projectKind: 'expansion',
  tags: ['altura'],
  currentRisksSimilarity: 0.5,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of p1; p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/portfolio-lessons/recommend', () => {
  const url = '/api/p1/portfolio-lessons/recommend';
  const body = { lessons: [L1, L2, L3_SELF], targetContext };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine recommendations, scored and ranked', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    const recos = res.body.recommendations;
    expect(Array.isArray(recos)).toBe(true);
    // L3-self filtered out (sourceProjectId === target.projectId); L1 + L2 remain.
    expect(recos.map((r: { lesson: LessonRecord }) => r.lesson.id)).toEqual(['L1', 'L2']);

    // L1: full match — 40 industry + 20 size + 10 kind + 15 sim + 10 sev + 5 tag.
    const [first, second] = recos;
    expect(first.lesson.id).toBe('L1');
    expect(first.matchScore).toBe(100);
    expect(first.highPriority).toBe(true); // score≥75 AND category incident
    expect(first.applicabilityReasons).toEqual([
      'Industria coincide (mineria)',
      'Tamaño aplicable (large)',
      'Tipo de proyecto coincide (expansion)',
      'Similitud de riesgos 50% (+15.0)',
      'Severity histórica critical (+10)',
      'Tags en común: altura (+5)',
    ]);
    // Real engine action set for an incident with high-or-above severity.
    expect(first.recommendedActions).toEqual([
      'Revisar control crítico asociado al incidente original (srcA)',
      'Replicar matriz de barreras (Bowtie) o equivalente en el nuevo contexto',
      'Severity histórica alta — escalar a líder SSO antes de iniciar trabajo asociado',
    ]);

    // L2: only the risk-similarity bonus matched (industry/size/kind/tags all miss).
    expect(second.lesson.id).toBe('L2');
    expect(second.matchScore).toBe(15);
    expect(second.highPriority).toBe(false);
    expect(second.applicabilityReasons).toEqual(['Similitud de riesgos 50% (+15.0)']);
  });

  it('200 honors minMatchScore (drops the low-scoring lesson)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, minMatchScore: 50 });
    expect(res.status).toBe(200);
    // L2's score (15) is below 50 → only L1 survives.
    expect(res.body.recommendations.map((r: { lesson: LessonRecord }) => r.lesson.id)).toEqual([
      'L1',
    ]);
  });

  it('200 honors maxResults (caps the result length)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, maxResults: 1 });
    expect(res.status).toBe(200);
    expect(res.body.recommendations).toHaveLength(1);
    expect(res.body.recommendations[0].lesson.id).toBe('L1');
  });

  it('400 on invalid body (missing targetContext)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ lessons: [L1] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an out-of-range currentRisksSimilarity (>1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        lessons: [L1],
        targetContext: { ...targetContext, currentRisksSimilarity: 2 },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an invalid lesson category enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        lessons: [{ ...L1, category: 'not-a-category' }],
        targetContext,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/portfolio-lessons/recommend')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/portfolio-lessons/recommend')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/portfolio-lessons/summarize', () => {
  const url = '/api/p1/portfolio-lessons/summarize';
  const body = { lessons: [L1, L2, L3_SELF] };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 returns the real portfolio summary', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    // Real engine output: counts by category + by industry, transferable = has
    // at least one declared industry OR size (all 3 fixtures qualify).
    expect(res.body.summary).toEqual({
      totalLessons: 3,
      byCategory: { incident: 1, good_practice: 1, efficiency: 1 },
      byIndustry: { mineria: 2, construccion: 1 },
      transferableCount: 3,
    });
  });

  it('200 for an empty lessons array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ lessons: [] });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({
      totalLessons: 0,
      byCategory: {},
      byIndustry: {},
      transferableCount: 0,
    });
  });

  it('400 when lessons is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ lessons: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a lesson is missing required fields', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ lessons: [{ id: 'x' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/portfolio-lessons/summarize')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
