// Praeventio Guard — Critical Controls Library + Robustness HTTP surface.
//
// Sprint 39 I.2 (§11-12, §302-310, §332) — nine stateless endpoints over
// engines under `src/services/criticalControls/`:
//
//   POST /:projectId/critical-controls/get-for-risk            { riskCategory }
//   POST /:projectId/critical-controls/validate-pre-task       { riskCategory, validations, now? }
//   POST /:projectId/critical-controls/robustness-score        { control }
//   POST /:projectId/critical-controls/superior-to             { level }
//   POST /:projectId/critical-controls/build-barrier-analysis  { riskCategory, catalog, validations }
//   POST /:projectId/critical-controls/detect-single-barrier   { riskCategories, catalog, validations }
//   POST /:projectId/critical-controls/verification-status     { controlId, frequency, lastVerifiedAt?, nowIso? }
//   POST /:projectId/critical-controls/energy-for-control      { controlId }
//   POST /:projectId/critical-controls/by-energy               { catalog }
//
// Pure compute — no Firestore writes. validatedByUid forced to caller
// on validate-pre-task.

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
  getControlsForRisk,
  validatePreTask,
  type CriticalControl,
  type ControlLevel,
  type ControlValidation,
} from '../../services/criticalControls/criticalControlsLibrary.js';
import {
  controlRobustnessScore,
  findControlSuperiorTo,
  buildBarrierAnalysis,
  detectSingleBarrierRisks,
  computeVerificationStatus,
  getEnergyTypeForControl,
  controlsByEnergy,
  type EnergyType,
  type ControlVerificationFrequency,
} from '../../services/criticalControls/controlRobustness.js';

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

const LEVELS: readonly ControlLevel[] = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'epp',
];
const METHODS = ['visual', 'instrument', 'documental', 'procedural'] as const;
const FREQUENCIES: readonly ControlVerificationFrequency[] = [
  'per_task',
  'daily',
  'weekly',
  'monthly',
  'per_event',
];

const controlSchema = z.object({
  id: z.string().min(1).max(200),
  riskCategory: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  level: z.enum(LEVELS as readonly [ControlLevel, ...ControlLevel[]]),
  verificationMethod: z.enum(METHODS),
  normReference: z.string().min(1).max(500),
}) as unknown as z.ZodType<CriticalControl>;

const validationSchema = z.object({
  controlId: z.string().min(1).max(200),
  present: z.boolean(),
  validatedByUid: z.string().min(1).max(200),
  validatedAt: z.string().min(10),
  evidenceUrl: z.string().min(1).max(2000).optional(),
  notes: z.string().min(0).max(2000).optional(),
}) as unknown as z.ZodType<ControlValidation>;

// ────────────────────────────────────────────────────────────────────────
// 1. get-for-risk
// ────────────────────────────────────────────────────────────────────────

const getForRiskSchema = z.object({
  riskCategory: z.string().min(1).max(200),
});

router.post(
  '/:projectId/critical-controls/get-for-risk',
  verifyAuth,
  validate(getForRiskSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof getForRiskSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const controls = getControlsForRisk(body.riskCategory);
      return res.json({ controls });
    } catch (err) {
      logger.error?.('criticalControls.getForRisk.error', err);
      captureRouteError(err, 'criticalControls.getForRisk');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. validate-pre-task — validatedByUid forced to caller
// ────────────────────────────────────────────────────────────────────────

const validatePreTaskSchema = z.object({
  riskCategory: z.string().min(1).max(200),
  validations: z.array(validationSchema).max(500),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/critical-controls/validate-pre-task',
  verifyAuth,
  validate(validatePreTaskSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validatePreTaskSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const result = validatePreTask(body.riskCategory, body.validations, callerUid, now);
      return res.json({ result });
    } catch (err) {
      logger.error?.('criticalControls.validatePreTask.error', err);
      captureRouteError(err, 'criticalControls.validatePreTask');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. robustness-score
// ────────────────────────────────────────────────────────────────────────

const robustnessSchema = z.object({
  control: z.object({
    level: z.enum(LEVELS as readonly [ControlLevel, ...ControlLevel[]]),
  }),
});

router.post(
  '/:projectId/critical-controls/robustness-score',
  verifyAuth,
  validate(robustnessSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof robustnessSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const score = controlRobustnessScore(body.control);
      return res.json({ score });
    } catch (err) {
      logger.error?.('criticalControls.robustnessScore.error', err);
      captureRouteError(err, 'criticalControls.robustnessScore');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. superior-to
// ────────────────────────────────────────────────────────────────────────

const superiorSchema = z.object({
  level: z.enum(LEVELS as readonly [ControlLevel, ...ControlLevel[]]),
});

router.post(
  '/:projectId/critical-controls/superior-to',
  verifyAuth,
  validate(superiorSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof superiorSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const levels = findControlSuperiorTo(body.level);
      return res.json({ levels });
    } catch (err) {
      logger.error?.('criticalControls.superiorTo.error', err);
      captureRouteError(err, 'criticalControls.superiorTo');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. build-barrier-analysis
// ────────────────────────────────────────────────────────────────────────

const barrierSchema = z.object({
  riskCategory: z.string().min(1).max(200),
  catalog: z.array(controlSchema).max(2000),
  validations: z.array(validationSchema).max(2000),
});

router.post(
  '/:projectId/critical-controls/build-barrier-analysis',
  verifyAuth,
  validate(barrierSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof barrierSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const analysis = buildBarrierAnalysis(body.riskCategory, body.catalog, body.validations);
      return res.json({ analysis });
    } catch (err) {
      logger.error?.('criticalControls.buildBarrierAnalysis.error', err);
      captureRouteError(err, 'criticalControls.buildBarrierAnalysis');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. detect-single-barrier
// ────────────────────────────────────────────────────────────────────────

const singleBarrierSchema = z.object({
  riskCategories: z.array(z.string().min(1).max(200)).max(200),
  catalog: z.array(controlSchema).max(2000),
  validations: z.array(validationSchema).max(2000),
});

router.post(
  '/:projectId/critical-controls/detect-single-barrier',
  verifyAuth,
  validate(singleBarrierSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof singleBarrierSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const analyses = detectSingleBarrierRisks(body.riskCategories, body.catalog, body.validations);
      return res.json({ analyses });
    } catch (err) {
      logger.error?.('criticalControls.detectSingleBarrier.error', err);
      captureRouteError(err, 'criticalControls.detectSingleBarrier');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 7. verification-status
// ────────────────────────────────────────────────────────────────────────

const verifSchema = z.object({
  controlId: z.string().min(1).max(200),
  frequency: z.enum(FREQUENCIES as readonly [ControlVerificationFrequency, ...ControlVerificationFrequency[]]),
  lastVerifiedAt: z.string().min(10).optional(),
  nowIso: z.string().min(10).optional(),
});

router.post(
  '/:projectId/critical-controls/verification-status',
  verifyAuth,
  validate(verifSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof verifSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const status = computeVerificationStatus(
        body.controlId,
        body.frequency,
        body.lastVerifiedAt,
        body.nowIso,
      );
      return res.json({ status });
    } catch (err) {
      logger.error?.('criticalControls.verificationStatus.error', err);
      captureRouteError(err, 'criticalControls.verificationStatus');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 8. energy-for-control
// ────────────────────────────────────────────────────────────────────────

const energyForSchema = z.object({
  controlId: z.string().min(1).max(200),
});

router.post(
  '/:projectId/critical-controls/energy-for-control',
  verifyAuth,
  validate(energyForSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof energyForSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const energy = getEnergyTypeForControl(body.controlId);
      return res.json({ energy: energy ?? null });
    } catch (err) {
      logger.error?.('criticalControls.energyForControl.error', err);
      captureRouteError(err, 'criticalControls.energyForControl');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 9. by-energy
// ────────────────────────────────────────────────────────────────────────

const byEnergySchema = z.object({
  catalog: z.array(controlSchema).max(2000),
});

router.post(
  '/:projectId/critical-controls/by-energy',
  verifyAuth,
  validate(byEnergySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof byEnergySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const grouped = controlsByEnergy(body.catalog);
      return res.json({ grouped });
    } catch (err) {
      logger.error?.('criticalControls.byEnergy.error', err);
      captureRouteError(err, 'criticalControls.byEnergy');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
