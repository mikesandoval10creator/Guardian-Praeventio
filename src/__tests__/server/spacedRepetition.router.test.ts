// Real-router supertest for the Spaced Repetition (SM-2) HTTP surface
// (src/server/routes/spacedRepetition.ts). Four stateless POST endpoints over
// the pure-compute engine in
// src/services/spacedRepetition/spacedRepetitionScheduler.ts:
//
//   POST /sprint-k/:projectId/spaced-repetition/create-card          → { card }
//   POST /sprint-k/:projectId/spaced-repetition/review-card           → { card }
//   POST /sprint-k/:projectId/spaced-repetition/select-due-cards      → { due }
//   POST /sprint-k/:projectId/spaced-repetition/build-retention-report → { report }
//
// Mounted in server.ts as `app.use('/api/sprint-k', spacedRepetitionRouter)`.
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore — 403 is exercised by NOT seeding the caller into the project.
// verifyAuth + logger + observability are mocked; the SM-2 engine runs UNMOCKED
// so every 200 asserts real deterministic compute derived from the SM-2 formulas
// in spacedRepetitionScheduler.ts, not from hand-coded constants.

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

import spacedRepetitionRouter from '../../server/routes/spacedRepetition.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  createInitialCard,
  reviewCard,
  selectDueCards,
  buildRetentionReport,
  type LearningCard,
} from '../../services/spacedRepetition/spacedRepetitionScheduler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', spacedRepetitionRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

/** A valid LearningCard with realistic defaults for reuse across tests. */
function baseCard(over: Partial<LearningCard> = {}): LearningCard {
  return {
    id: 'card-1',
    workerUid: 'w1',
    topic: 'altura R1',
    initiallyLearnedAt: '2026-01-01T00:00:00.000Z',
    reviewCount: 0,
    easeFactor: 2.5,
    intervalDays: 1,
    nextReviewAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // u1 is a member of p1; u1 is NOT a member of p2.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['other'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/spaced-repetition/create-card
// ────────────────────────────────────────────────────────────────────────

describe('POST /api/sprint-k/:projectId/spaced-repetition/create-card', () => {
  const url = '/api/sprint-k/p1/spaced-repetition/create-card';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({
      cardId: 'c1',
      workerUid: 'w1',
      topic: 'EPP básico',
      initiallyLearnedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(401);
  });

  it('200 returns an initial LearningCard matching the engine output', async () => {
    const body = {
      cardId: 'c1',
      workerUid: 'w1',
      topic: 'altura R1',
      initiallyLearnedAt: '2026-05-01T00:00:00.000Z',
    };
    const expected = createInitialCard(body.cardId, body.workerUid, body.topic, body.initiallyLearnedAt);
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.card.id).toBe('c1');
    expect(res.body.card.workerUid).toBe('w1');
    expect(res.body.card.topic).toBe('altura R1');
    expect(res.body.card.reviewCount).toBe(0);
    expect(res.body.card.easeFactor).toBe(2.5);
    expect(res.body.card.intervalDays).toBe(1);
    // nextReviewAt is +1 day from initiallyLearnedAt
    expect(res.body.card.nextReviewAt).toBe(expected.nextReviewAt);
  });

  it('400 when cardId is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({
      workerUid: 'w1',
      topic: 'EPP',
      initiallyLearnedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when initiallyLearnedAt is too short (min 10 chars)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({
      cardId: 'c1',
      workerUid: 'w1',
      topic: 'EPP',
      initiallyLearnedAt: '2026',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/spaced-repetition/create-card')
      .set(uid)
      .send({
        cardId: 'c1',
        workerUid: 'w1',
        topic: 'EPP',
        initiallyLearnedAt: '2026-01-01T00:00:00.000Z',
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/spaced-repetition/review-card
// ────────────────────────────────────────────────────────────────────────

describe('POST /api/sprint-k/:projectId/spaced-repetition/review-card', () => {
  const url = '/api/sprint-k/p1/spaced-repetition/review-card';
  const nowIso = '2026-05-10T00:00:00.000Z';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ card: baseCard(), quality: 5 });
    expect(res.status).toBe(401);
  });

  it('200 quality 5 (perfect) applies SM-2 ease-factor increase and extends interval', async () => {
    // reviewCount=0 → first review → intervalDays becomes 1 (SM-2 rule for first review).
    // easeFactor increases: 2.5 + (0.1-(5-5)*(0.08+(5-5)*0.02)) = 2.5+0.1 = 2.6
    const card = baseCard({ reviewCount: 0, easeFactor: 2.5, intervalDays: 1 });
    const expected = reviewCard(card, 5, nowIso);
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ card, quality: 5, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.card.reviewCount).toBe(1);
    expect(res.body.card.easeFactor).toBe(expected.easeFactor);
    expect(res.body.card.intervalDays).toBe(expected.intervalDays);
    expect(res.body.card.lastQuality).toBe(5);
    expect(res.body.card.nextReviewAt).toBe(expected.nextReviewAt);
  });

  it('200 quality 2 (fail) resets interval to 1 day and clamps easeFactor at 1.3', async () => {
    // reviewCount=5, easeFactor=1.3 (already at floor), quality=2 → fail path.
    const card = baseCard({ reviewCount: 5, easeFactor: 1.3, intervalDays: 30 });
    const expected = reviewCard(card, 2, nowIso);
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ card, quality: 2, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.card.intervalDays).toBe(1);
    expect(res.body.card.easeFactor).toBe(1.3); // clamped
    expect(res.body.card.lastQuality).toBe(2);
    expect(res.body.card.nextReviewAt).toBe(expected.nextReviewAt);
  });

  it('200 quality 4 with reviewCount>1 extends interval by easeFactor * intervalDays', async () => {
    // reviewCount=2, intervalDays=6, easeFactor=2.5, quality=4
    // new interval = round(6 * 2.5*(0.1-(5-4)*(0.08+(5-4)*0.02))) = round(6 * ef)
    const card = baseCard({ reviewCount: 2, easeFactor: 2.5, intervalDays: 6 });
    const expected = reviewCard(card, 4, nowIso);
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ card, quality: 4, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.card.intervalDays).toBe(expected.intervalDays);
    expect(res.body.card.easeFactor).toBe(expected.easeFactor);
  });

  it('400 when quality is outside 0-5 range', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ card: baseCard(), quality: 6, nowIso });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when card.easeFactor is below the SM-2 minimum (1.3)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ card: baseCard({ easeFactor: 1.0 }), quality: 4, nowIso });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/spaced-repetition/review-card')
      .set(uid)
      .send({ card: baseCard(), quality: 5, nowIso });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/spaced-repetition/select-due-cards
// ────────────────────────────────────────────────────────────────────────

describe('POST /api/sprint-k/:projectId/spaced-repetition/select-due-cards', () => {
  const url = '/api/sprint-k/p1/spaced-repetition/select-due-cards';
  const nowIso = '2026-05-10T12:00:00.000Z';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ cards: [] });
    expect(res.status).toBe(401);
  });

  it('200 returns only cards whose nextReviewAt <= nowIso, sorted by date asc', async () => {
    const overdue = baseCard({ id: 'c-old', nextReviewAt: '2026-05-01T00:00:00.000Z' });
    const due = baseCard({ id: 'c-due', nextReviewAt: '2026-05-10T11:59:00.000Z' });
    const future = baseCard({ id: 'c-future', nextReviewAt: '2026-05-11T00:00:00.000Z' });
    const cards = [future, due, overdue]; // intentionally out of order

    const expected = selectDueCards(cards, nowIso);
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ cards, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.due).toHaveLength(2);
    expect(res.body.due.map((c: LearningCard) => c.id)).toEqual(
      expected.map((c) => c.id),
    );
    // First card in response is the oldest (sorted ascending)
    expect(res.body.due[0].id).toBe('c-old');
  });

  it('200 empty array when all cards are in the future', async () => {
    const cards = [baseCard({ nextReviewAt: '2026-12-31T00:00:00.000Z' })];
    const res = await request(buildApp()).post(url).set(uid).send({ cards, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.due).toEqual([]);
  });

  it('200 empty array when cards is empty', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ cards: [], nowIso });
    expect(res.status).toBe(200);
    expect(res.body.due).toEqual([]);
  });

  it('400 when cards is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ cards: 'nope', nowIso });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/spaced-repetition/select-due-cards')
      .set(uid)
      .send({ cards: [], nowIso });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/spaced-repetition/build-retention-report
// ────────────────────────────────────────────────────────────────────────

describe('POST /api/sprint-k/:projectId/spaced-repetition/build-retention-report', () => {
  const url = '/api/sprint-k/p1/spaced-repetition/build-retention-report';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ cards: [], workerUid: 'w1' });
    expect(res.status).toBe(401);
  });

  it('200 consolidatedPercent + weakTopics + averageIntervalDays from real engine', async () => {
    // 3 cards for w1:
    //  - c1: intervalDays=90 → consolidated (>30), NOT weak
    //  - c2: intervalDays=5  → weak (<=7), NOT consolidated
    //  - c3: intervalDays=7  → weak (<=7), NOT consolidated
    // consolidated = 1/3 → 33%; weakTopics = ['quimicos', 'electrico'] (Set, unique);
    // avg = round((90+5+7)/3) = round(34) = 34
    const cards: LearningCard[] = [
      baseCard({ id: 'c1', workerUid: 'w1', topic: 'altura', intervalDays: 90, nextReviewAt: '2026-07-01T00:00:00.000Z' }),
      baseCard({ id: 'c2', workerUid: 'w1', topic: 'quimicos', intervalDays: 5, nextReviewAt: '2026-05-15T00:00:00.000Z' }),
      baseCard({ id: 'c3', workerUid: 'w1', topic: 'electrico', intervalDays: 7, nextReviewAt: '2026-05-17T00:00:00.000Z' }),
      // c4 belongs to another worker — should NOT be counted in w1's report
      baseCard({ id: 'c4', workerUid: 'w2', topic: 'ruido', intervalDays: 1, nextReviewAt: '2026-05-11T00:00:00.000Z' }),
    ];
    const expected = buildRetentionReport(cards, 'w1');
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ cards, workerUid: 'w1' });
    expect(res.status).toBe(200);
    expect(res.body.report.workerUid).toBe('w1');
    expect(res.body.report.totalCards).toBe(expected.totalCards);
    expect(res.body.report.consolidatedPercent).toBe(expected.consolidatedPercent);
    expect(res.body.report.weakTopics).toEqual(expected.weakTopics);
    expect(res.body.report.averageIntervalDays).toBe(expected.averageIntervalDays);
  });

  it('200 returns zeroed report when no cards belong to the requested workerUid', async () => {
    const cards = [baseCard({ workerUid: 'other' })];
    const expected = buildRetentionReport(cards, 'w1');
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ cards, workerUid: 'w1' });
    expect(res.status).toBe(200);
    expect(res.body.report).toEqual(expected);
    expect(res.body.report.totalCards).toBe(0);
    expect(res.body.report.consolidatedPercent).toBe(0);
  });

  it('400 when cards is missing from the body', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ workerUid: 'w1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when workerUid is an empty string (min 1)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ cards: [], workerUid: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/spaced-repetition/build-retention-report')
      .set(uid)
      .send({ cards: [], workerUid: 'w1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// Type-only guard: keep imported engine types referenced to prevent pruning.
const _typeCheck: keyof LearningCard = 'id';
void _typeCheck;
