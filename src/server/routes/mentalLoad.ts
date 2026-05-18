// Praeventio Guard — Mental Load (NASA-TLX) + Admin Burden HTTP surface.
//
// Sprint K §258-260 — two stateless endpoints over the engine under
// `src/services/mentalLoad/mentalLoadTracker.ts`:
//
//   POST /:projectId/mental-load/score-survey
//     body: MentalLoadSurvey (workerUid forced from caller)
//     200:  { score: MentalLoadScore }
//
//   POST /:projectId/mental-load/build-admin-burden
//     body: { tasks, workerUid }
//     200:  { report: AdminBurdenReport }
//
// Pure compute — no Firestore writes. The §258-260 admin-burden
// formulation here is the per-worker variant (full-week minutes
// percentage). The org-wide variant lives at /admin-burden/report.

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
  scoreMentalLoad,
  buildAdminBurdenReport,
  type MentalLoadSurvey,
  type AdminTaskTime,
} from '../../services/mentalLoad/mentalLoadTracker.js';

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

const ADMIN_TASK_KINDS = [
  'form_filling',
  'signature_request',
  'document_upload',
  'meeting',
  'report_writing',
  'data_entry',
  'approval_chase',
] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. score-survey — workerUid forced to authenticated caller
// ────────────────────────────────────────────────────────────────────────

const surveySchema = z.object({
  mentalDemand: z.number().min(0).max(100),
  physicalDemand: z.number().min(0).max(100),
  temporalDemand: z.number().min(0).max(100),
  effort: z.number().min(0).max(100),
  frustration: z.number().min(0).max(100),
  performance: z.number().min(0).max(100),
  surveyedAt: z.string().min(10),
});

router.post(
  '/:projectId/mental-load/score-survey',
  verifyAuth,
  validate(surveySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof surveySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const survey: MentalLoadSurvey = { ...body, workerUid: callerUid };
      const score = scoreMentalLoad(survey);
      return res.json({ score });
    } catch (err) {
      logger.error?.('mentalLoad.scoreSurvey.error', err);
      captureRouteError(err, 'mentalLoad.scoreSurvey');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-admin-burden
// ────────────────────────────────────────────────────────────────────────

const adminTaskSchema = z.object({
  workerUid: z.string().min(1).max(200),
  kind: z.enum(ADMIN_TASK_KINDS),
  minutesPerWeek: z.number().nonnegative().max(100_000),
}) as unknown as z.ZodType<AdminTaskTime>;

const burdenSchema = z.object({
  tasks: z.array(adminTaskSchema).max(10_000),
  workerUid: z.string().min(1).max(200),
});

router.post(
  '/:projectId/mental-load/build-admin-burden',
  verifyAuth,
  validate(burdenSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof burdenSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildAdminBurdenReport(body.tasks, body.workerUid);
      return res.json({ report });
    } catch (err) {
      logger.error?.('mentalLoad.buildAdminBurden.error', err);
      captureRouteError(err, 'mentalLoad.buildAdminBurden');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
