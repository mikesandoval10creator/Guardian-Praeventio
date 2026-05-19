// Praeventio Guard — Ergonomics REBA/RULA HTTP surface.
//
// Two stateless endpoints over the engines under `src/services/ergonomics/`:
//
//   POST /:projectId/ergonomics/calculate-reba
//     body: RebaInput
//     200:  { result: RebaResult }
//
//   POST /:projectId/ergonomics/calculate-rula
//     body: RulaInput
//     200:  { result: RulaResult }
//
// Pure compute — no Firestore writes. Canonical scoring per Hignett &
// McAtamney (REBA, 2000) and McAtamney & Corlett (RULA, 1993).
// Replaces AI delegation for safety-critical ergonomic scoring.

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
  calculateReba,
  type RebaInput,
} from '../../services/ergonomics/reba.js';
import {
  calculateRula,
  type RulaInput,
} from '../../services/ergonomics/rula.js';

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

const COUPLINGS = ['good', 'fair', 'poor', 'unacceptable'] as const;
const FORCE_PATTERNS = ['intermittent', 'static', 'repeated', 'shock'] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. calculate-reba
// ────────────────────────────────────────────────────────────────────────

const rebaSchema = z.object({
  trunk: z.object({
    flexionDeg: z.number().min(-90).max(180),
    twisted: z.boolean().optional(),
    sideBent: z.boolean().optional(),
  }),
  neck: z.object({
    flexionDeg: z.number().min(-90).max(180),
    twisted: z.boolean().optional(),
    sideBent: z.boolean().optional(),
  }),
  legs: z.object({
    bilateralSupport: z.boolean(),
    kneeFlexionDeg: z.number().min(0).max(180),
  }),
  upperArm: z.object({
    flexionDeg: z.number().min(-90).max(180),
    shoulderRaised: z.boolean().optional(),
    abducted: z.boolean().optional(),
    supported: z.boolean().optional(),
  }),
  lowerArm: z.object({
    flexionDeg: z.number().min(0).max(180),
  }),
  wrist: z.object({
    flexionDeg: z.number().min(-90).max(90),
    twistedOrDeviated: z.boolean().optional(),
  }),
  load: z.object({
    kg: z.number().nonnegative().max(1000),
    shockOrRapid: z.boolean().optional(),
  }),
  coupling: z.enum(COUPLINGS),
  activity: z.object({
    staticOver1Min: z.boolean().optional(),
    repeatedSmallRange: z.boolean().optional(),
    rapidLargeRangeChanges: z.boolean().optional(),
  }),
}) as unknown as z.ZodType<RebaInput>;

router.post(
  '/:projectId/ergonomics/calculate-reba',
  verifyAuth,
  validate(rebaSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rebaSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculateReba(body);
      return res.json({ result });
    } catch (err) {
      logger.error?.('ergonomics.calculateReba.error', err);
      captureRouteError(err, 'ergonomics.calculateReba');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. calculate-rula
// ────────────────────────────────────────────────────────────────────────

const rulaSchema = z.object({
  upperArm: z.object({
    flexionDeg: z.number().min(-90).max(180),
    shoulderRaised: z.boolean().optional(),
    abducted: z.boolean().optional(),
    supported: z.boolean().optional(),
  }),
  lowerArm: z.object({
    flexionDeg: z.number().min(0).max(180),
    acrossMidlineOrOut: z.boolean().optional(),
  }),
  wrist: z.object({
    flexionDeg: z.number().min(-90).max(90),
    deviated: z.boolean().optional(),
  }),
  wristTwist: z.enum(['mid', 'end']),
  neck: z.object({
    flexionDeg: z.number().min(-90).max(180),
    inExtension: z.boolean().optional(),
    twisted: z.boolean().optional(),
    sideBent: z.boolean().optional(),
  }),
  trunk: z.object({
    flexionDeg: z.number().min(-90).max(180),
    wellSupported: z.boolean().optional(),
    twisted: z.boolean().optional(),
    sideBent: z.boolean().optional(),
  }),
  legs: z.object({
    supportedAndBalanced: z.boolean(),
  }),
  muscleUse: z.object({
    staticOver1Min: z.boolean().optional(),
    repeatedOver4Min: z.boolean().optional(),
  }),
  force: z.object({
    kg: z.number().nonnegative().max(1000),
    pattern: z.enum(FORCE_PATTERNS),
  }),
}) as unknown as z.ZodType<RulaInput>;

router.post(
  '/:projectId/ergonomics/calculate-rula',
  verifyAuth,
  validate(rulaSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rulaSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculateRula(body);
      return res.json({ result });
    } catch (err) {
      logger.error?.('ergonomics.calculateRula.error', err);
      captureRouteError(err, 'ergonomics.calculateRula');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
