// Praeventio Guard — Return-to-Work + restricciones + derivación HTTP surface.
//
// Sprint 49 §251-254 — three stateless endpoints over the engine under
// `src/services/returnToWork/returnToWorkPlanner.ts`:
//
//   POST /:projectId/return-to-work/assess-task-fit
//     body: { workerRestrictions, task, now? }
//     200:  { assessment: TaskFitAssessment }
//
//   POST /:projectId/return-to-work/decide-derivation
//     body: { input, now? }
//     200:  { derivation: MutualityDerivation }
//
//   POST /:projectId/return-to-work/build-plan
//     body: BuildRtwPlanInput
//     200:  { plan: ReturnToWorkPlan }
//
// Pure compute — no Firestore writes. ADR 0012: motor opera con
// `restrictionTags` operacionales, NUNCA con diagnóstico médico (PHI).

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
  assessTaskFit,
  decideDerivation,
  buildReturnToWorkPlan,
  type WorkerRestriction,
  type TaskRequirements,
  type DerivationDecisionInput,
  type BuildRtwPlanInput,
} from '../../services/returnToWork/returnToWorkPlanner.js';

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

// ────────────────────────────────────────────────────────────────────────
// Engine-derived enums (verified from source)
// ────────────────────────────────────────────────────────────────────────

const RESTRICTION_TAGS = [
  'no_lifting_above_10kg',
  'no_lifting_above_25kg',
  'no_repetitive_movement_hand',
  'no_repetitive_movement_shoulder',
  'no_prolonged_standing',
  'no_prolonged_sitting',
  'no_squatting',
  'no_kneeling',
  'no_overhead_work',
  'no_height_work',
  'no_confined_spaces',
  'no_extreme_temperature',
  'no_high_noise',
  'no_chemical_exposure',
  'no_vibration_exposure',
  'no_uv_extreme',
  'no_night_shift',
  'no_isolated_work',
  'no_decision_under_pressure',
  'no_driving',
  'reduced_hours',
  'requires_buddy',
  'requires_frequent_breaks',
] as const;

const RESTRICTION_SOURCES = [
  'mutual_doctor_order',
  'company_doctor_order',
  'self_reported',
  'supervisor_observation',
] as const;

const MUTUALITIES = ['achs', 'ist', 'mutual', 'isl'] as const;

const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical', 'sif'] as const;

const INCIDENT_KINDS = [
  'fall',
  'cut',
  'burn',
  'crush',
  'chemical',
  'electric',
  'psychological',
  'other',
] as const;

const ABSENCE_KINDS = [
  'sick_leave',
  'work_injury_leave',
  'maternity',
  'personal',
  'other',
] as const;

const workerRestrictionSchema = z.object({
  workerUid: z.string().min(1).max(200),
  tag: z.enum(RESTRICTION_TAGS),
  startsAt: z.string().min(10),
  expiresAt: z.string().min(10).optional(),
  source: z.enum(RESTRICTION_SOURCES),
  evidenceDocId: z.string().min(1).max(200).optional(),
  requiresReview: z.boolean().optional(),
  reviewIntervalDays: z.number().int().positive().max(3650).optional(),
}) as unknown as z.ZodType<WorkerRestriction>;

const taskRequirementsSchema = z.object({
  taskId: z.string().min(1).max(200),
  conflictsWith: z.array(z.enum(RESTRICTION_TAGS)).max(50),
  physicalLoad: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  cognitiveLoad: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  estimatedMinutes: z.number().int().nonnegative().max(100_000).optional(),
}) as unknown as z.ZodType<TaskRequirements>;

// ────────────────────────────────────────────────────────────────────────
// 1. assess-task-fit
// ────────────────────────────────────────────────────────────────────────

const assessTaskFitSchema = z.object({
  workerRestrictions: z.array(workerRestrictionSchema).max(200),
  task: taskRequirementsSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/return-to-work/assess-task-fit',
  verifyAuth,
  validate(assessTaskFitSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof assessTaskFitSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const assessment = assessTaskFit(body.workerRestrictions, body.task, now);
      return res.json({ assessment });
    } catch (err) {
      logger.error?.('returnToWork.assessTaskFit.error', err);
      captureRouteError(err, 'returnToWork.assessTaskFit');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. decide-derivation
// ────────────────────────────────────────────────────────────────────────

const derivationInputSchema = z.object({
  workerUid: z.string().min(1).max(200),
  workerMutuality: z.enum(MUTUALITIES),
  incidentSeverity: z.enum(INCIDENT_SEVERITIES).optional(),
  incidentKind: z.enum(INCIDENT_KINDS).optional(),
  commuteEvent: z.boolean().optional(),
  workerHasLostTime: z.boolean().optional(),
  occupationalSuspicion: z.boolean().optional(),
}) as unknown as z.ZodType<DerivationDecisionInput>;

const decideDerivationSchema = z.object({
  input: derivationInputSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/return-to-work/decide-derivation',
  verifyAuth,
  validate(decideDerivationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof decideDerivationSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const derivation = decideDerivation(body.input, now);
      return res.json({ derivation });
    } catch (err) {
      logger.error?.('returnToWork.decideDerivation.error', err);
      captureRouteError(err, 'returnToWork.decideDerivation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. build-plan
// ────────────────────────────────────────────────────────────────────────

const buildPlanSchema = z.object({
  workerUid: z.string().min(1).max(200),
  absenceFrom: z.string().min(10),
  absenceTo: z.string().min(10),
  absenceKind: z.enum(ABSENCE_KINDS),
  activeRestrictions: z.array(workerRestrictionSchema).max(200),
}) as unknown as z.ZodType<BuildRtwPlanInput>;

router.post(
  '/:projectId/return-to-work/build-plan',
  verifyAuth,
  validate(buildPlanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildPlanSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const plan = buildReturnToWorkPlan(body);
      return res.json({ plan });
    } catch (err) {
      logger.error?.('returnToWork.buildPlan.error', err);
      captureRouteError(err, 'returnToWork.buildPlan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
