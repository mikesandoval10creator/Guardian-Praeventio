// Praeventio Guard — Circadian Rhythm + Alertness HTTP surface.
//
// Sprint K §256-257 — three stateless endpoints over the engine under
// `src/services/circadian/circadianRhythmService.ts`:
//
//   POST /:projectId/circadian/classify-window
//     body: { localHour }
//     200:  { window: CircadianWindow }
//
//   POST /:projectId/circadian/assess-alertness
//     body: CircadianInput
//     200:  { report: AlertnessReport }
//
//   POST /:projectId/circadian/recommend-shift-rotation
//     body: ShiftWorker
//     200:  { recommendation: ShiftRotationRecommendation }
//
// Pure compute — no Firestore writes. Determinístico, sin LLM.
// Recomendaciones nunca bloquean maquinaria automáticamente — solo
// sugieren al supervisor (directiva #2).

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
  classifyCircadianWindow,
  assessAlertness,
  recommendShiftRotation,
  type CircadianInput,
  type ShiftWorker,
} from '../../services/circadian/circadianRhythmService.js';

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

const SHIFT_KINDS = ['day', 'night', 'rotative'] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. classify-window
// ────────────────────────────────────────────────────────────────────────

const classifySchema = z.object({
  localHour: z.number().int().min(0).max(23),
});

router.post(
  '/:projectId/circadian/classify-window',
  verifyAuth,
  validate(classifySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof classifySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const window = classifyCircadianWindow(body.localHour);
      return res.json({ window });
    } catch (err) {
      logger.error?.('circadian.classifyWindow.error', err);
      captureRouteError(err, 'circadian.classifyWindow');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. assess-alertness
// ────────────────────────────────────────────────────────────────────────

const alertnessSchema = z.object({
  localHour: z.number().int().min(0).max(23),
  sleepHoursLast24h: z.number().min(0).max(24),
  consecutiveNightShifts: z.number().int().min(0).max(365),
  mentalLoadRating: z.number().int().min(1).max(10).optional(),
}) as unknown as z.ZodType<CircadianInput>;

router.post(
  '/:projectId/circadian/assess-alertness',
  verifyAuth,
  validate(alertnessSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof alertnessSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = assessAlertness(body);
      return res.json({ report });
    } catch (err) {
      logger.error?.('circadian.assessAlertness.error', err);
      captureRouteError(err, 'circadian.assessAlertness');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. recommend-shift-rotation
// ────────────────────────────────────────────────────────────────────────

const shiftWorkerSchema = z.object({
  workerUid: z.string().min(1).max(200),
  currentShiftDays: z.number().int().min(0).max(365),
  currentShiftKind: z.enum(SHIFT_KINDS),
  hoursWorkedWeek: z.number().min(0).max(200),
}) as unknown as z.ZodType<ShiftWorker>;

router.post(
  '/:projectId/circadian/recommend-shift-rotation',
  verifyAuth,
  validate(shiftWorkerSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof shiftWorkerSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const recommendation = recommendShiftRotation(body);
      return res.json({ recommendation });
    } catch (err) {
      logger.error?.('circadian.recommendShiftRotation.error', err);
      captureRouteError(err, 'circadian.recommendShiftRotation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
