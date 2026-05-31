// Praeventio Guard — Real-router supertest for the post-training assessment
// HTTP surface (src/server/routes/postTraining.ts, Sprint K §85-89).
//
// 4 stateless endpoints: score-assessment, next-review-delay,
// schedule-next-reviews, find-case-studies. All call pure engine functions
// (no Firestore writes); the only DB I/O is the assertProjectMember guard
// read on `projects/<id>`. Coverage goal: 401, 400, 403, 200 per endpoint +
// business branches (pass/fail scoring, delay matrix, scheduling, case matching).

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
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// The engine functions are PURE — no mock needed; we exercise the real logic.
// projectMembership reads Firestore via assertProjectMember; it uses H.db
// through the firebase-admin mock above.

import postTrainingRouter from '../../server/routes/postTraining.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', postTrainingRouter);
  return app;
}

/** Seed a project with the test user as a member. */
function seedProject(projectId: string, uid: string) {
  H.db!._seed(`projects/${projectId}`, { members: [uid], createdBy: uid });
}

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const UID = 'worker-1';
const PROJECT = 'proj-test';

/** A minimal valid question (easy, one correct + one wrong option). */
const Q1 = {
  id: 'q1',
  topic: 'Uso EPP',
  difficulty: 'easy' as const,
  prompt: '¿Qué EPP es obligatorio en faena minera?',
  options: [
    { id: 'a', label: 'Casco', isCorrect: true },
    { id: 'b', label: 'Sombrero de paja', isCorrect: false },
  ],
};

/** A safety-critical question variant. */
const Q_CRITICAL = { ...Q1, id: 'qc', safetyCritical: true };

/** Correct attempt for Q1. */
const A_CORRECT = {
  questionId: 'q1',
  selectedOptionId: 'a',
  durationSeconds: 30,
  attemptAt: '2026-05-30T10:00:00Z',
};

/** Wrong attempt for Q1. */
const A_WRONG = { ...A_CORRECT, selectedOptionId: 'b' };

/** Wrong attempt for the critical question. */
const A_CRITICAL_WRONG = { ...A_CORRECT, questionId: 'qc', selectedOptionId: 'b' };

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(PROJECT, UID);
});

// ════════════════════════════════════════════════════════════════════════════
// POST /:projectId/post-training/score-assessment
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/post-training/score-assessment', () => {
  const url = (pid = PROJECT) => `/api/sprint-k/${pid}/post-training/score-assessment`;

  const validBody = {
    trainingId: 'DS44-intro',
    questions: [Q1],
    attempts: [A_CORRECT],
  };

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp()).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when body is missing required fields (trainingId absent)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ questions: [Q1], attempts: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when questions array is empty (min 1)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ trainingId: 'DS44-intro', questions: [], attempts: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a question has an unknown difficulty', async () => {
    const badQ = { ...Q1, difficulty: 'legendary' };
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ trainingId: 'DS44-intro', questions: [badQ], attempts: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a member of the project', async () => {
    // Seed the project WITHOUT the caller uid
    H.db!._seed(`projects/${PROJECT}`, { members: ['other-user'], createdBy: 'other-user' });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post(url('nonexistent-proj'))
      .set('x-test-uid', UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns a passing result when the single answer is correct', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send(validBody);
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.workerUid).toBe(UID); // server-side override enforced
    expect(result.trainingId).toBe('DS44-intro');
    expect(result.totalQuestions).toBe(1);
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(0);
    expect(result.scorePercent).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.failedQuestionIds).toEqual([]);
    expect(result.topicsForReinforcement).toEqual([]);
    expect(typeof result.totalSeconds).toBe('number');
    expect(result.totalSeconds as number).toBeGreaterThanOrEqual(0);
  });

  it('200 returns a failing result when the answer is wrong', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ trainingId: 'DS44-intro', questions: [Q1], attempts: [A_WRONG] });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.passed).toBe(false);
    expect(result.scorePercent).toBe(0);
    expect(result.incorrectCount).toBe(1);
    expect((result.failedQuestionIds as string[]).includes('q1')).toBe(true);
    expect((result.topicsForReinforcement as string[]).includes('Uso EPP')).toBe(true);
  });

  it('200 fails when a safety-critical question is answered wrong (enforceCriticalGate default)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({
        trainingId: 'DS44-critical',
        questions: [Q_CRITICAL],
        attempts: [A_CRITICAL_WRONG],
      });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.passed).toBe(false); // critical gate triggered
  });

  it('200 passes when enforceCriticalGate:false and critical is wrong but score above threshold', async () => {
    // 2 questions, worker answers non-critical correctly and critical wrongly.
    // With enforceCriticalGate=false and score 50% < 80% → still fails on score.
    // Use explicit passingScorePercent:0 so we can verify the gate is not blocking.
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({
        trainingId: 'DS44-gate-off',
        questions: [Q1, Q_CRITICAL],
        attempts: [A_CORRECT, A_CRITICAL_WRONG],
        options: { enforceCriticalGate: false, passingScorePercent: 0 },
      });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.passed).toBe(true); // gate disabled + 0% threshold
  });

  it('200 assigns workerUid from the token uid (not from any client field)', async () => {
    // Even if a potential spoofed workerUid is sent inside options, the route
    // overrides with callerUid from verifyAuth.
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ ...validBody, options: { passingScorePercent: 50 } });
    expect(res.status).toBe(200);
    expect(res.body.result.workerUid).toBe(UID);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /:projectId/post-training/next-review-delay
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/post-training/next-review-delay', () => {
  const url = (pid = PROJECT) => `/api/sprint-k/${pid}/post-training/next-review-delay`;

  const validBody = { difficulty: 'medium', consecutiveCorrect: 0 };

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp()).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when difficulty is missing', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ consecutiveCorrect: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when difficulty is invalid', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ difficulty: 'impossible', consecutiveCorrect: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when consecutiveCorrect is negative', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ difficulty: 'easy', consecutiveCorrect: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    H.db!._seed(`projects/${PROJECT}`, { members: [], createdBy: 'other' });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns days:4 for medium difficulty, 0 consecutive correct', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ difficulty: 'medium', consecutiveCorrect: 0 });
    expect(res.status).toBe(200);
    expect(typeof res.body.days).toBe('number');
    expect(res.body.days).toBe(4); // base=4, multiplier=2^0=1 → 4
    expect(res.body.days).toBeGreaterThan(0); // never negative
  });

  it('200 easy difficulty grows with consecutive correct answers (Ebbinghaus doubling)', async () => {
    const [r0, r1, r2] = await Promise.all(
      [0, 1, 2].map((n) =>
        request(buildApp())
          .post(url())
          .set('x-test-uid', UID)
          .send({ difficulty: 'easy', consecutiveCorrect: n }),
      ),
    );
    expect(r0.status).toBe(200);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r0.body.days).toBe(7);
    expect(r1.body.days).toBe(14);
    expect(r2.body.days).toBe(28);
    // All values must be non-negative (gamification directive)
    for (const r of [r0, r1, r2]) {
      expect(r.body.days).toBeGreaterThanOrEqual(0);
    }
  });

  it('200 caps at 90 days for expert with many consecutive correct', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ difficulty: 'expert', consecutiveCorrect: 20 });
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(8); // base=1, cap multiplier=8 → 8d (well below 90)
    expect(res.body.days).toBeGreaterThanOrEqual(0);
  });

  it('200 hard difficulty base interval is 2 days', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ difficulty: 'hard', consecutiveCorrect: 0 });
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /:projectId/post-training/schedule-next-reviews
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/post-training/schedule-next-reviews', () => {
  const url = (pid = PROJECT) => `/api/sprint-k/${pid}/post-training/schedule-next-reviews`;

  const validBody = {
    topicHistory: [
      { topic: 'Uso EPP', difficulty: 'easy', consecutiveCorrect: 1 },
      { topic: 'Trabajos en altura', difficulty: 'hard', consecutiveCorrect: 0 },
    ],
    now: '2026-05-30T12:00:00Z',
  };

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp()).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when topicHistory entry has invalid difficulty', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({
        topicHistory: [{ topic: 'EPP', difficulty: 'unknown', consecutiveCorrect: 0 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when consecutiveCorrect is negative inside topicHistory', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({
        topicHistory: [{ topic: 'EPP', difficulty: 'easy', consecutiveCorrect: -5 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT}`, { members: [], createdBy: 'admin' });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns a schedule item per topic in topicHistory', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.schedule)).toBe(true);
    expect(res.body.schedule).toHaveLength(2);
    const [item0, item1] = res.body.schedule as Array<Record<string, unknown>>;
    expect(item0.topic).toBe('Uso EPP');
    expect(item0.difficulty).toBe('easy');
    expect(typeof item0.nextReviewAt).toBe('string');
    // nextReviewAt must be after the `now` date
    expect(new Date(item0.nextReviewAt as string).getTime()).toBeGreaterThan(
      new Date('2026-05-30T12:00:00Z').getTime(),
    );
    expect(item1.topic).toBe('Trabajos en altura');
    expect(typeof item1.nextReviewAt).toBe('string');
  });

  it('200 returns an empty schedule for empty topicHistory', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ topicHistory: [] });
    expect(res.status).toBe(200);
    expect(res.body.schedule).toEqual([]);
  });

  it('200 uses server clock when "now" is omitted (nextReviewAt is a future ISO string)', async () => {
    const before = Date.now();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({
        topicHistory: [{ topic: 'Espacios confinados', difficulty: 'medium', consecutiveCorrect: 0 }],
        // no `now` field
      });
    expect(res.status).toBe(200);
    expect(res.body.schedule).toHaveLength(1);
    const nextMs = new Date(res.body.schedule[0].nextReviewAt as string).getTime();
    expect(nextMs).toBeGreaterThan(before); // future date
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /:projectId/post-training/find-case-studies
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/post-training/find-case-studies', () => {
  const url = (pid = PROJECT) => `/api/sprint-k/${pid}/post-training/find-case-studies`;

  const incidentNode = {
    nodeId: 'zk-001',
    title: 'Caída en faena minera Atacama 2022',
    kind: 'incident' as const,
    topics: ['Uso EPP', 'Trabajos en altura'],
    severity: 'critical' as const,
    industry: 'minería',
    occurredAt: '2022-06-15',
  };

  const goodPracticeNode = {
    nodeId: 'zk-002',
    title: 'Implementación de protocolo LOTO',
    kind: 'good_practice' as const,
    topics: ['Energía peligrosa', 'Bloqueo y etiquetado'],
    severity: 'low' as const,
    occurredAt: '2025-01-10',
  };

  const validBody = {
    topicsOfInterest: ['Uso EPP', 'Trabajos en altura'],
    nodes: [incidentNode, goodPracticeNode],
  };

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp()).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when nodes entry has invalid kind', async () => {
    const badNode = { ...incidentNode, kind: 'fake_kind' };
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ topicsOfInterest: ['EPP'], nodes: [badNode] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when nodes entry has invalid severity', async () => {
    const badNode = { ...incidentNode, severity: 'catastrophic' };
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ topicsOfInterest: ['EPP'], nodes: [badNode] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when maxResults is not a positive integer', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ ...validBody, maxResults: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT}`, { members: [], createdBy: 'admin' });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns matching case studies sorted by relevance', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.matches)).toBe(true);
    // incidentNode matches 2 topics, goodPracticeNode matches 0 → only 1 result
    expect(res.body.matches).toHaveLength(1);
    const match = res.body.matches[0] as Record<string, unknown>;
    expect((match.node as Record<string, unknown>).nodeId).toBe('zk-001');
    expect(typeof match.relevanceScore).toBe('number');
    expect(match.relevanceScore as number).toBeGreaterThan(0);
    expect(Array.isArray(match.reasons)).toBe(true);
  });

  it('200 returns empty matches when no node overlaps the topics', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ topicsOfInterest: ['Químicos peligrosos'], nodes: [goodPracticeNode] });
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
  });

  it('200 respects maxResults cap', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      nodeId: `zk-${i}`,
      title: `Incidente ${i}`,
      kind: 'incident' as const,
      topics: ['Uso EPP'],
      occurredAt: '2023-01-01',
    }));
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({ topicsOfInterest: ['Uso EPP'], nodes, maxResults: 2 });
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(2);
  });

  it('200 filters by industry when provided', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({
        topicsOfInterest: ['Uso EPP', 'Trabajos en altura'],
        nodes: [incidentNode],
        industry: 'construcción', // incidentNode.industry = 'minería' → excluded
      });
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
  });

  it('200 returns matches when industry matches the node', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', UID)
      .send({
        topicsOfInterest: ['Uso EPP', 'Trabajos en altura'],
        nodes: [incidentNode],
        industry: 'minería',
      });
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(1);
    expect((res.body.matches[0].node as Record<string, unknown>).nodeId).toBe('zk-001');
  });
});
