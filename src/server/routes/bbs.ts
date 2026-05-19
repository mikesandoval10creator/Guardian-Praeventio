// Praeventio Guard — Behavior-Based Safety (BBS) HTTP surface.
//
// Sprint K — two stateless endpoints over the engine under
// `src/services/behaviorObservation/bbsObservationEngine.ts`:
//
//   POST /:projectId/bbs/record-observation
//     body: { observationId, areaId, category, outcome, note }
//     200:  { observation: BbsObservation }
//     400:  { error: 'validation_error', code, message }
//
//   POST /:projectId/bbs/build-profile
//     body: { tenantId, observations, windowStart, windowEnd }
//     200:  { profile: BbsProfile }
//     400:  { error: 'validation_error', code, message }
//
// Pure compute — no Firestore writes. observerUid is server-side identity
// override: BBS is anti-blaming, observador es siempre el caller. tenantId
// and now are server-controlled.

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
  recordObservation,
  buildProfile,
  BbsValidationError,
  type BbsObservation,
  type ObservationCategory,
  type BehaviorOutcome,
} from '../../services/behaviorObservation/bbsObservationEngine.js';

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

const CATEGORIES: readonly ObservationCategory[] = [
  'epp',
  'positioning',
  'tools_equipment',
  'procedures',
  'housekeeping',
  'ergonomics',
  'communication',
];
const OUTCOMES: readonly BehaviorOutcome[] = ['safe', 'at_risk'];

// ────────────────────────────────────────────────────────────────────────
// 1. record-observation
// ────────────────────────────────────────────────────────────────────────

const recordSchema = z.object({
  observationId: z.string().min(1).max(200),
  areaId: z.string().min(1).max(200),
  category: z.enum(CATEGORIES as readonly [ObservationCategory, ...ObservationCategory[]]),
  outcome: z.enum(OUTCOMES as readonly [BehaviorOutcome, ...BehaviorOutcome[]]),
  note: z.string().min(5).max(5000),
});

router.post(
  '/:projectId/bbs/record-observation',
  verifyAuth,
  validate(recordSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recordSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const observation = recordObservation({
        observationId: body.observationId,
        tenantId: projectId,
        areaId: body.areaId,
        category: body.category,
        outcome: body.outcome,
        note: body.note,
        observerUid: callerUid,
      });
      return res.json({ observation });
    } catch (err) {
      if (err instanceof BbsValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('bbs.recordObservation.error', err);
      captureRouteError(err, 'bbs.recordObservation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-profile
// ────────────────────────────────────────────────────────────────────────

const observationSchema = z.object({
  observationId: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  areaId: z.string().min(1).max(200),
  category: z.enum(CATEGORIES as readonly [ObservationCategory, ...ObservationCategory[]]),
  outcome: z.enum(OUTCOMES as readonly [BehaviorOutcome, ...BehaviorOutcome[]]),
  note: z.string().min(1).max(5000),
  observerUid: z.string().min(1).max(200),
  observedAt: z.string().min(10),
}) as unknown as z.ZodType<BbsObservation>;

const profileSchema = z.object({
  observations: z.array(observationSchema).max(50_000),
  windowStart: z.string().min(10),
  windowEnd: z.string().min(10),
});

router.post(
  '/:projectId/bbs/build-profile',
  verifyAuth,
  validate(profileSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof profileSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const profile = buildProfile({
        tenantId: projectId,
        observations: body.observations,
        windowStart: new Date(body.windowStart),
        windowEnd: new Date(body.windowEnd),
      });
      return res.json({ profile });
    } catch (err) {
      if (err instanceof BbsValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('bbs.buildProfile.error', err);
      captureRouteError(err, 'bbs.buildProfile');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
