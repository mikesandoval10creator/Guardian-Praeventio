// Praeventio Guard — AI Toggle HTTP surface.
//
// 3 stateless endpoints (pure compute over caller-supplied inputs):
//   POST /:projectId/ai-mode/decide
//     body: AiCapabilitySnapshot
//     200:  { decision: AiModeDecision }
//   POST /:projectId/ai-mode/rules-only-check
//     body: AiCapabilitySnapshot
//     200:  { rulesOnly: boolean }
//   POST /:projectId/ai-mode/rule-drift
//     body: { samples, options? }
//     200:  { alerts: DriftAlert[] }
//
// No Firestore writes — the engine is pure compute and the caller
// builds the capability snapshot from client-side network/battery probes
// plus tenant budget reads. Rule application samples come from the
// caller's own analytics pipeline.

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
  decideAiMode,
  shouldUseRulesOnly,
} from '../../services/aiToggle/aiModeController.js';
import { detectRuleDrift } from '../../services/aiToggle/ruleDriftDetector.js';

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

const NETWORK_CLASSES = [
  'wifi',
  'cellular_4g',
  'cellular_3g',
  'edge_or_worse',
  'offline',
] as const;

const BATTERY_CLASSES = ['plenty', 'sufficient', 'low', 'critical'] as const;

const USER_PREFS = ['auto', 'cloud', 'local', 'off'] as const;

const snapshotSchema = z.object({
  networkClass: z.enum(NETWORK_CLASSES),
  batteryClass: z.enum(BATTERY_CLASSES),
  userPref: z.enum(USER_PREFS),
  localModelLoaded: z.boolean(),
  tenantBudgetExceeded: z.boolean(),
});

router.post(
  '/:projectId/ai-mode/decide',
  verifyAuth,
  validate(snapshotSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof snapshotSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = decideAiMode(body);
      return res.json({ decision });
    } catch (err) {
      logger.error?.('aiToggle.decide.error', err);
      captureRouteError(err, 'aiToggle.decide');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/ai-mode/rules-only-check',
  verifyAuth,
  validate(snapshotSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof snapshotSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const rulesOnly = shouldUseRulesOnly(body);
      return res.json({ rulesOnly });
    } catch (err) {
      logger.error?.('aiToggle.rulesOnlyCheck.error', err);
      captureRouteError(err, 'aiToggle.rulesOnlyCheck');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const ruleSampleSchema = z.object({
  ruleId: z.string().min(1).max(200),
  period: z.string().min(4).max(20),
  applicationCount: z.number().int().nonnegative(),
  totalEntitiesEvaluated: z.number().int().nonnegative(),
});

const ruleDriftSchema = z.object({
  samples: z.array(ruleSampleSchema).min(1).max(10000),
  options: z
    .object({
      baselineWindow: z.number().int().min(1).max(120).optional(),
      minBaselinePeriods: z.number().int().min(1).max(120).optional(),
      minBaselineRatio: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

router.post(
  '/:projectId/ai-mode/rule-drift',
  verifyAuth,
  validate(ruleDriftSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof ruleDriftSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const alerts = detectRuleDrift(body.samples, body.options);
      return res.json({ alerts });
    } catch (err) {
      logger.error?.('aiToggle.ruleDrift.error', err);
      captureRouteError(err, 'aiToggle.ruleDrift');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
