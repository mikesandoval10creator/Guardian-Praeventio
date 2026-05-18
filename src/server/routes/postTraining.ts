// Praeventio Guard — Post-Training Assessment HTTP surface.
//
// Sprint K §85-89 — post-training learning (assessment scoring + spaced
// repetition + real case-study matching). Engine extends Sprint J
// training catalog with safety-critical gates and Ebbinghaus-inspired
// review intervals.
//
// 4 stateless endpoints over the engine under
// `src/services/postTraining/postTrainingAssessmentEngine.ts`:
//
//   POST /:projectId/post-training/score-assessment
//     body: { trainingId, questions, attempts, options? }
//     200:  { result: AssessmentResult }
//
//   POST /:projectId/post-training/next-review-delay
//     body: { difficulty, consecutiveCorrect }
//     200:  { days: number }
//
//   POST /:projectId/post-training/schedule-next-reviews
//     body: { topicHistory, now? }
//     200:  { schedule: ReviewScheduleItem[] }
//
//   POST /:projectId/post-training/find-case-studies
//     body: { topicsOfInterest, nodes, industry?, maxResults?, preferSevere? }
//     200:  { matches: CaseStudyMatch[] }
//
// Server-side override: workerUid = callerUid (assessment scored
// against the authenticated worker, never trust client-supplied
// workerUid for grading).

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
  scoreAssessment,
  nextReviewDelayDays,
  scheduleNextReviews,
  findRelevantCaseStudies,
  type AssessmentQuestion,
  type AssessmentAttempt,
  type CaseStudyNode,
} from '../../services/postTraining/postTrainingAssessmentEngine.js';

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

const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;

const SEVERITIES = ['low', 'medium', 'high', 'critical', 'sif'] as const;

const CASE_STUDY_KINDS = [
  'incident',
  'near_miss',
  'good_practice',
  'lesson_learned',
] as const;

const questionSchema = z.object({
  id: z.string().min(1).max(200),
  topic: z.string().min(1).max(200),
  difficulty: z.enum(DIFFICULTIES),
  prompt: z.string().min(1).max(5000),
  options: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        label: z.string().min(1).max(1000),
        isCorrect: z.boolean(),
        rationale: z.string().max(2000).optional(),
      }),
    )
    .min(2)
    .max(20),
  safetyCritical: z.boolean().optional(),
}) as unknown as z.ZodType<AssessmentQuestion>;

const attemptSchema = z.object({
  questionId: z.string().min(1).max(200),
  selectedOptionId: z.string().min(1).max(50),
  durationSeconds: z.number().nonnegative().max(86_400),
  attemptAt: z.string().min(10),
}) as unknown as z.ZodType<AssessmentAttempt>;

const caseStudyNodeSchema = z.object({
  nodeId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  kind: z.enum(CASE_STUDY_KINDS),
  topics: z.array(z.string().min(1).max(200)).max(50),
  severity: z.enum(SEVERITIES).optional(),
  industry: z.string().min(1).max(120).optional(),
  occurredAt: z.string().min(10),
}) as unknown as z.ZodType<CaseStudyNode>;

// ────────────────────────────────────────────────────────────────────────
// 1. score-assessment (workerUid forced to callerUid)
// ────────────────────────────────────────────────────────────────────────

const scoreAssessmentSchema = z.object({
  trainingId: z.string().min(1).max(200),
  questions: z.array(questionSchema).min(1).max(200),
  attempts: z.array(attemptSchema).max(200),
  options: z
    .object({
      passingScorePercent: z.number().min(0).max(100).optional(),
      enforceCriticalGate: z.boolean().optional(),
    })
    .optional(),
});

router.post(
  '/:projectId/post-training/score-assessment',
  verifyAuth,
  validate(scoreAssessmentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof scoreAssessmentSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = scoreAssessment(
        callerUid,
        body.trainingId,
        body.questions,
        body.attempts,
        body.options,
      );
      return res.json({ result });
    } catch (err) {
      logger.error?.('postTraining.scoreAssessment.error', err);
      captureRouteError(err, 'postTraining.scoreAssessment');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. next-review-delay
// ────────────────────────────────────────────────────────────────────────

const nextReviewDelaySchema = z.object({
  difficulty: z.enum(DIFFICULTIES),
  consecutiveCorrect: z.number().int().nonnegative().max(100),
});

router.post(
  '/:projectId/post-training/next-review-delay',
  verifyAuth,
  validate(nextReviewDelaySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof nextReviewDelaySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const days = nextReviewDelayDays(body.difficulty, body.consecutiveCorrect);
      return res.json({ days });
    } catch (err) {
      logger.error?.('postTraining.nextReviewDelay.error', err);
      captureRouteError(err, 'postTraining.nextReviewDelay');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. schedule-next-reviews
// ────────────────────────────────────────────────────────────────────────

const topicHistoryEntrySchema = z.object({
  topic: z.string().min(1).max(200),
  difficulty: z.enum(DIFFICULTIES),
  consecutiveCorrect: z.number().int().nonnegative().max(100),
});

const scheduleNextReviewsSchema = z.object({
  topicHistory: z.array(topicHistoryEntrySchema).max(500),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/post-training/schedule-next-reviews',
  verifyAuth,
  validate(scheduleNextReviewsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof scheduleNextReviewsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const schedule = scheduleNextReviews(callerUid, body.topicHistory, {
        now: body.now ? new Date(body.now) : new Date(),
      });
      return res.json({ schedule });
    } catch (err) {
      logger.error?.('postTraining.scheduleNextReviews.error', err);
      captureRouteError(err, 'postTraining.scheduleNextReviews');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. find-case-studies
// ────────────────────────────────────────────────────────────────────────

const findCaseStudiesSchema = z.object({
  topicsOfInterest: z.array(z.string().min(1).max(200)).max(50),
  nodes: z.array(caseStudyNodeSchema).max(500),
  industry: z.string().min(1).max(120).optional(),
  maxResults: z.number().int().positive().max(50).optional(),
  preferSevere: z.boolean().optional(),
});

router.post(
  '/:projectId/post-training/find-case-studies',
  verifyAuth,
  validate(findCaseStudiesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof findCaseStudiesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const matches = findRelevantCaseStudies(body.topicsOfInterest, body.nodes, {
        industry: body.industry,
        maxResults: body.maxResults,
        preferSevere: body.preferSevere,
      });
      return res.json({ matches });
    } catch (err) {
      logger.error?.('postTraining.findCaseStudies.error', err);
      captureRouteError(err, 'postTraining.findCaseStudies');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
