// Praeventio Guard — Fatigue Monitor HTTP surface.
//
// Sprint 39 I.4 (§65-67) — one stateless endpoint over the engine under
// `src/services/fatigue/fatigueMonitor.ts`:
//
//   POST /:projectId/fatigue/assess
//     body: { workerUid, sessions, now? }
//     200:  { assessment: FatigueAssessment }
//
// Pure compute — no Firestore writes. Thresholds anchored on DS 594
// art. 102 (max 12h/24h jornada continua), Código del Trabajo art. 38
// (min 11h descanso entre turnos), MINSAL protocolo turnos nocturnos.
// Per directive #2, NEVER blocks machinery — only flags `shouldRestrictCritical`.

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
  assessFatigue,
  type WorkSession,
} from '../../services/fatigue/fatigueMonitor.js';

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

const sessionSchema = z.object({
  workerUid: z.string().min(1).max(200),
  startedAt: z.string().min(10),
  endedAt: z.string().min(10).optional(),
  isNight: z.boolean(),
  hadCriticalTasks: z.boolean(),
}) as unknown as z.ZodType<WorkSession>;

const assessSchema = z.object({
  workerUid: z.string().min(1).max(200),
  sessions: z.array(sessionSchema).max(10_000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/fatigue/assess',
  verifyAuth,
  validate(assessSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof assessSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : undefined;
      const assessment = assessFatigue(body.workerUid, body.sessions, now);
      return res.json({ assessment });
    } catch (err) {
      logger.error?.('fatigue.assess.error', err);
      captureRouteError(err, 'fatigue.assess');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
