// Praeventio Guard — Reputational Alerts HTTP surface.
//
// Sprint K §120 — external reputational alert detection. Engine clusters
// external signals (news / social / official records / regulators /
// community complaints) within a sliding window and emits alerts with
// severity + recommendation.
//
// 2 stateless endpoints over the engine under
// `src/services/reputationalAlerts/reputationalAlertEngine.ts`:
//
//   POST /:projectId/reputational-alerts/analyze
//     body: { signals, windowDays? }
//     200:  { alerts: ReputationalAlert[] }
//
//   POST /:projectId/reputational-alerts/summarize
//     body: { signals, windowDays? }
//     200:  { summary: ReputationalRiskSummary }
//
// Engine is fully deterministic — no Firestore writes. Note: the engine
// accepts an optional `now: () => Date` factory; we don't expose it over
// HTTP (caller serves their own clock).

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
  analyzeReputationalRisk,
  summarizeReputationalRisk,
  type ExternalSignal,
} from '../../services/reputationalAlerts/reputationalAlertEngine.js';

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

const SOURCES = [
  'news',
  'social_media',
  'official_record',
  'regulator',
  'community_complaint',
] as const;

const SENTIMENTS = ['negative', 'neutral', 'positive'] as const;

const REACHES = ['local', 'regional', 'national', 'international'] as const;

const signalSchema = z.object({
  source: z.enum(SOURCES),
  keyword: z.string().min(1).max(500),
  publishedAt: z.string().min(10),
  url: z.string().min(1).max(2000).optional(),
  sentiment: z.enum(SENTIMENTS),
  reach: z.enum(REACHES),
  flags: z
    .object({
      fatality: z.boolean().optional(),
      regulatorAction: z.boolean().optional(),
    })
    .optional(),
}) as unknown as z.ZodType<ExternalSignal>;

// ────────────────────────────────────────────────────────────────────────
// 1. analyze
// ────────────────────────────────────────────────────────────────────────

const analyzeSchema = z.object({
  signals: z.array(signalSchema).max(1000),
  windowDays: z.number().int().positive().max(365).optional(),
});

router.post(
  '/:projectId/reputational-alerts/analyze',
  verifyAuth,
  validate(analyzeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof analyzeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const alerts = analyzeReputationalRisk(body.signals, {
        windowDays: body.windowDays,
      });
      return res.json({ alerts });
    } catch (err) {
      logger.error?.('reputationalAlerts.analyze.error', err);
      captureRouteError(err, 'reputationalAlerts.analyze');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. summarize
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  signals: z.array(signalSchema).max(1000),
  windowDays: z.number().int().positive().max(365).optional(),
});

router.post(
  '/:projectId/reputational-alerts/summarize',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeReputationalRisk(body.signals, {
        windowDays: body.windowDays,
      });
      return res.json({ summary });
    } catch (err) {
      logger.error?.('reputationalAlerts.summarize.error', err);
      captureRouteError(err, 'reputationalAlerts.summarize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
