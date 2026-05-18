// Praeventio Guard — Portfolio Lessons Engine HTTP surface.
//
// Sprint K §131-138 — Project Closure + Lessons Transferibles. Engine
// matches captured lessons from past projects against a target project's
// context (industry / size / kind / tags / risk similarity), scoring
// transferability and producing recommended actions.
//
// 2 stateless endpoints over the engine under
// `src/services/portfolioLessons/portfolioLessonsEngine.ts`:
//
//   POST /:projectId/portfolio-lessons/recommend
//     body: { lessons, targetContext, maxResults?, minMatchScore? }
//     200:  { recommendations: LessonTransferRecommendation[] }
//
//   POST /:projectId/portfolio-lessons/summarize
//     body: { lessons }
//     200:  { summary: PortfolioSummary }
//
// Engine is fully deterministic — no Firestore writes. Caller persists
// lesson recommendations / summary to their own collection.

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
  recommendLessons,
  summarizePortfolioLearning,
  type LessonRecord,
  type TargetProjectContext,
} from '../../services/portfolioLessons/portfolioLessonsEngine.js';

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

const LESSON_CATEGORIES = [
  'incident',
  'near_miss',
  'good_practice',
  'efficiency',
  'compliance',
  'culture',
] as const;

const PROJECT_SIZES = ['small', 'medium', 'large', 'enterprise'] as const;

const LESSON_SEVERITIES = ['low', 'medium', 'high', 'critical', 'sif'] as const;

const lessonSchema = z.object({
  id: z.string().min(1).max(200),
  sourceProjectId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  category: z.enum(LESSON_CATEGORIES),
  applicableIndustries: z.array(z.string().min(1).max(120)).max(50),
  applicableSizes: z.array(z.enum(PROJECT_SIZES)).max(4),
  applicableProjectKinds: z.array(z.string().min(1).max(120)).max(50).optional(),
  capturedAt: z.string().min(10),
  tags: z.array(z.string().min(1).max(120)).max(100),
  originalSeverity: z.enum(LESSON_SEVERITIES).optional(),
  estimatedTransferValueClp: z.number().nonnegative().optional(),
}) as unknown as z.ZodType<LessonRecord>;

const targetContextSchema = z.object({
  projectId: z.string().min(1).max(200),
  industry: z.string().min(1).max(120),
  size: z.enum(PROJECT_SIZES),
  projectKind: z.string().min(1).max(120).optional(),
  tags: z.array(z.string().min(1).max(120)).max(100).optional(),
  currentRisksSimilarity: z.number().min(0).max(1),
}) as unknown as z.ZodType<TargetProjectContext>;

// ────────────────────────────────────────────────────────────────────────
// 1. recommend
// ────────────────────────────────────────────────────────────────────────

const recommendSchema = z.object({
  lessons: z.array(lessonSchema).max(2000),
  targetContext: targetContextSchema,
  maxResults: z.number().int().positive().max(100).optional(),
  minMatchScore: z.number().min(0).max(100).optional(),
});

router.post(
  '/:projectId/portfolio-lessons/recommend',
  verifyAuth,
  validate(recommendSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recommendSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const recommendations = recommendLessons(
        body.lessons,
        body.targetContext,
        {
          maxResults: body.maxResults,
          minMatchScore: body.minMatchScore,
        },
      );
      return res.json({ recommendations });
    } catch (err) {
      logger.error?.('portfolioLessons.recommend.error', err);
      captureRouteError(err, 'portfolioLessons.recommend');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. summarize
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  lessons: z.array(lessonSchema).max(5000),
});

router.post(
  '/:projectId/portfolio-lessons/summarize',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizePortfolioLearning(body.lessons);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('portfolioLessons.summarize.error', err);
      captureRouteError(err, 'portfolioLessons.summarize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
