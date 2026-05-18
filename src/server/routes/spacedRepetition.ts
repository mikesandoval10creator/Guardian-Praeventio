// Praeventio Guard — Spaced Repetition (SM-2) HTTP surface.
//
// Sprint K §85-89 — four stateless endpoints over the engine under
// `src/services/spacedRepetition/spacedRepetitionScheduler.ts`:
//
//   POST /:projectId/spaced-repetition/create-card
//     body: { cardId, workerUid, topic, initiallyLearnedAt }
//     200:  { card: LearningCard }
//
//   POST /:projectId/spaced-repetition/review-card
//     body: { card, quality (0-5), nowIso? }
//     200:  { card: LearningCard }
//
//   POST /:projectId/spaced-repetition/select-due-cards
//     body: { cards, nowIso? }
//     200:  { due: LearningCard[] }
//
//   POST /:projectId/spaced-repetition/build-retention-report
//     body: { cards, workerUid }
//     200:  { report: RetentionReport }
//
// Pure compute — no Firestore writes. Determinístico, sin LLM. Distinto
// del wireup `postTraining` (también sprint K §85-89) que cubre el
// scoring de assessment Ebbinghaus; este es el scheduler SM-2 que la UI
// alterna usando el ease factor por card.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  reviewCard,
  createInitialCard,
  selectDueCards,
  buildRetentionReport,
  type LearningCard,
} from '../../services/spacedRepetition/spacedRepetitionScheduler.js';

const router = Router();

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
  return true;
}

const learningCardSchema = z.object({
  id: z.string().min(1).max(200),
  workerUid: z.string().min(1).max(200),
  topic: z.string().min(1).max(500),
  initiallyLearnedAt: z.string().min(10),
  reviewCount: z.number().int().nonnegative().max(10_000),
  easeFactor: z.number().min(1.3).max(10),
  intervalDays: z.number().int().nonnegative().max(10_000),
  nextReviewAt: z.string().min(10),
  lastQuality: z.number().int().min(0).max(5).optional(),
}) as unknown as z.ZodType<LearningCard>;

// ────────────────────────────────────────────────────────────────────────
// 1. create-card
// ────────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  cardId: z.string().min(1).max(200),
  workerUid: z.string().min(1).max(200),
  topic: z.string().min(1).max(500),
  initiallyLearnedAt: z.string().min(10),
});

router.post(
  '/:projectId/spaced-repetition/create-card',
  verifyAuth,
  validate(createSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const card = createInitialCard(
        body.cardId,
        body.workerUid,
        body.topic,
        body.initiallyLearnedAt,
      );
      return res.json({ card });
    } catch (err) {
      logger.error?.('spacedRepetition.createCard.error', err);
      captureRouteError(err, 'spacedRepetition.createCard');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. review-card
// ────────────────────────────────────────────────────────────────────────

const reviewSchema = z.object({
  card: learningCardSchema,
  quality: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  nowIso: z.string().min(10).optional(),
});

router.post(
  '/:projectId/spaced-repetition/review-card',
  verifyAuth,
  validate(reviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof reviewSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const nowIso = body.nowIso ?? new Date().toISOString();
      const card = reviewCard(body.card, body.quality, nowIso);
      return res.json({ card });
    } catch (err) {
      logger.error?.('spacedRepetition.reviewCard.error', err);
      captureRouteError(err, 'spacedRepetition.reviewCard');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. select-due-cards
// ────────────────────────────────────────────────────────────────────────

const dueSchema = z.object({
  cards: z.array(learningCardSchema).max(50_000),
  nowIso: z.string().min(10).optional(),
});

router.post(
  '/:projectId/spaced-repetition/select-due-cards',
  verifyAuth,
  validate(dueSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof dueSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const nowIso = body.nowIso ?? new Date().toISOString();
      const due = selectDueCards(body.cards, nowIso);
      return res.json({ due });
    } catch (err) {
      logger.error?.('spacedRepetition.selectDueCards.error', err);
      captureRouteError(err, 'spacedRepetition.selectDueCards');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. build-retention-report
// ────────────────────────────────────────────────────────────────────────

const retentionSchema = z.object({
  cards: z.array(learningCardSchema).max(50_000),
  workerUid: z.string().min(1).max(200),
});

router.post(
  '/:projectId/spaced-repetition/build-retention-report',
  verifyAuth,
  validate(retentionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof retentionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildRetentionReport(body.cards, body.workerUid);
      return res.json({ report });
    } catch (err) {
      logger.error?.('spacedRepetition.buildRetentionReport.error', err);
      captureRouteError(err, 'spacedRepetition.buildRetentionReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
