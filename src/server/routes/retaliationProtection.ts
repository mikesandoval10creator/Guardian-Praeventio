// Praeventio Guard — Retaliation Protection HTTP surface.
//
// Sprint K §211-213 (Ley Karin 21.643 anti-retaliation). After a
// confidential report is filed, this engine analyzes signals observed
// within an evaluation window (default 90d) and recommends protective
// actions per risk level.
//
// 2 stateless endpoints over the engine under
// `src/services/retaliationProtection/retaliationDetector.ts`:
//
//   POST /:projectId/retaliation/analyze
//     body: { reportFiledAt, signals, evaluationWindowDays? }
//     200:  { assessment: RetaliationRiskAssessment }
//
//   POST /:projectId/retaliation/recommend-actions
//     body: { assessment }
//     200:  { actions: ProtectiveAction[] }
//
// Engine is fully deterministic — no Firestore writes. Caller persists
// assessments + actions to their own collection (likely under the
// existing confidentialReports adapter from #332).

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
  analyzeRetaliationRisk,
  recommendProtectiveActions,
  type RetaliationRiskAssessment,
  type RetaliationSignal,
} from '../../services/retaliationProtection/retaliationDetector.js';

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

const SIGNAL_KINDS = [
  'salary_change',
  'shift_change_negative',
  'role_demoted',
  'isolation',
  'increased_scrutiny',
  'task_reassignment',
] as const;

const SIGNAL_SEVERITIES = ['low', 'medium', 'high'] as const;

const signalSchema = z.object({
  kind: z.enum(SIGNAL_KINDS),
  severity: z.enum(SIGNAL_SEVERITIES),
  observedAt: z.string().min(10),
  reporterUid: z.string().min(1).max(120),
  supervisorUid: z.string().min(1).max(120),
}) as unknown as z.ZodType<RetaliationSignal>;

// ────────────────────────────────────────────────────────────────────────
// 1. analyze
// ────────────────────────────────────────────────────────────────────────

const analyzeSchema = z.object({
  reportFiledAt: z.string().min(10),
  signals: z.array(signalSchema).max(500),
  evaluationWindowDays: z.number().int().positive().max(730).optional(),
});

router.post(
  '/:projectId/retaliation/analyze',
  verifyAuth,
  validate(analyzeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof analyzeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const assessment = analyzeRetaliationRisk(
        body.reportFiledAt,
        body.signals,
        body.evaluationWindowDays !== undefined
          ? { evaluationWindowDays: body.evaluationWindowDays }
          : undefined,
      );
      return res.json({ assessment });
    } catch (err) {
      logger.error?.('retaliationProtection.analyze.error', err);
      captureRouteError(err, 'retaliationProtection.analyze');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. recommend-actions
// ────────────────────────────────────────────────────────────────────────

// RetaliationRiskAssessment is the engine output shape — accept loosely.
const assessmentSchema = z.unknown() as unknown as z.ZodType<RetaliationRiskAssessment>;

const recommendActionsSchema = z.object({
  assessment: assessmentSchema,
});

router.post(
  '/:projectId/retaliation/recommend-actions',
  verifyAuth,
  validate(recommendActionsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recommendActionsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const actions = recommendProtectiveActions(body.assessment);
      return res.json({ actions });
    } catch (err) {
      logger.error?.('retaliationProtection.recommendActions.error', err);
      captureRouteError(err, 'retaliationProtection.recommendActions');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
