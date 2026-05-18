// Praeventio Guard — Industrial Hygiene (Mifflin-St Jeor BMR) HTTP surface.
//
// Two stateless endpoints over the engine under
// `src/services/hygiene/metabolicRate.ts`:
//
//   POST /:projectId/hygiene/bmr
//     body: { weightKg, heightCm, ageYears, sex }
//     200:  { bmr: number | null }
//
//   POST /:projectId/hygiene/current-burn
//     body: { bmr, hourOfDay }
//     200:  { burn: number | null }
//
// Pure compute — no Firestore writes. Returns `null` when inputs are
// incomplete (engine intentionally refuses to substitute a fake number;
// callers must surface "completa tu perfil" instead).

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
  calculateMifflinStJeor,
  estimateCurrentBurn,
} from '../../services/hygiene/metabolicRate.js';

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

const SEX = ['male', 'female'] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. bmr — accepts partial input; engine returns null when incomplete.
// ────────────────────────────────────────────────────────────────────────

const bmrSchema = z.object({
  weightKg: z.number().positive().max(500).optional(),
  heightCm: z.number().positive().max(300).optional(),
  ageYears: z.number().positive().max(150).optional(),
  sex: z.enum(SEX).optional(),
});

router.post(
  '/:projectId/hygiene/bmr',
  verifyAuth,
  validate(bmrSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof bmrSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const bmr = calculateMifflinStJeor(body);
      return res.json({ bmr });
    } catch (err) {
      logger.error?.('hygiene.bmr.error', err);
      captureRouteError(err, 'hygiene.bmr');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. current-burn
// ────────────────────────────────────────────────────────────────────────

const burnSchema = z.object({
  bmr: z.number().positive().max(100_000).nullable(),
  hourOfDay: z.number().min(0).max(24),
});

router.post(
  '/:projectId/hygiene/current-burn',
  verifyAuth,
  validate(burnSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof burnSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const burn = estimateCurrentBurn(body.bmr, body.hourOfDay);
      return res.json({ burn });
    } catch (err) {
      logger.error?.('hygiene.currentBurn.error', err);
      captureRouteError(err, 'hygiene.currentBurn');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
