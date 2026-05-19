// Praeventio Guard — Safety talks topic suggester HTTP surface.
//
// One stateless endpoint over the engine under
// `src/services/safetyTalks/talkTopicSuggester.ts`:
//
//   POST /:projectId/safety-talks/suggest    { signals }
//     200:  { suggestions: SafetyTalkSuggestion[] }
//
// Pure compute — no Firestore writes. Deterministic ranking of safety
// talk topics based on context signals (recent incidents + active risks
// + today's tasks + open findings + weather + new workers).

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
  suggestTalks,
  type ContextSignals,
} from '../../services/safetyTalks/talkTopicSuggester.js';

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

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const signalsSchema = z.object({
  recentIncidents: z.array(z.object({
    kind: z.string().min(1).max(200),
    severity: z.enum(SEVERITIES),
  })).max(10_000),
  activeRisks: z.array(z.string().min(1).max(200)).max(500),
  todaysTaskCategories: z.array(z.string().min(1).max(200)).max(500),
  openFindingsByCategory: z.record(z.string(), z.number().int().nonnegative().max(10_000)),
  weather: z.object({
    uvIndex: z.number().min(0).max(20).optional(),
    temperatureC: z.number().min(-80).max(80).optional(),
    windSpeedKmh: z.number().nonnegative().max(500).optional(),
    rainProbabilityPercent: z.number().min(0).max(100).optional(),
  }).optional(),
  newWorkersCount: z.number().int().nonnegative().max(100_000),
}) as unknown as z.ZodType<ContextSignals>;

const suggestSchema = z.object({
  signals: signalsSchema,
});

router.post(
  '/:projectId/safety-talks/suggest',
  verifyAuth,
  validate(suggestSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof suggestSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const suggestions = suggestTalks(body.signals);
      return res.json({ suggestions });
    } catch (err) {
      logger.error?.('safetyTalks.suggest.error', err);
      captureRouteError(err, 'safetyTalks.suggest');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
