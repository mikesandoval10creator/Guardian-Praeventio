// Praeventio Guard — Pain-Based Upsell Suggester HTTP surface.
//
// Sprint K §116 — sugerencias de upsell basadas en dolor real (manual
// reports, exceptions, data confidence, scale). Engine identifies pain
// signals and recommends addons or tier upgrades that *measurably*
// alleviate the detected pain — never blind upsells.
//
// 1 stateless endpoint over the engine under
// `src/services/upsell/painBasedUpsellSuggester.ts`:
//
//   POST /:projectId/upsell/suggest
//     body: UsagePainSignals
//     200:  { suggestions: UpsellSuggestion[] }
//
// Pure compute — no Firestore writes.

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
import { suggestUpsell } from '../../services/upsell/painBasedUpsellSuggester.js';

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

const TIERS = ['free', 'starter', 'pro', 'enterprise'] as const;

const signalsSchema = z.object({
  manualReportsPerWeek: z.number().nonnegative().max(10_000),
  exceptionsRaisedLast30d: z.number().nonnegative().max(100_000),
  dataConfidenceScore: z.number().min(0).max(1),
  currentTier: z.enum(TIERS),
  activeProjectCount: z.number().int().nonnegative().max(10_000).optional(),
});

router.post(
  '/:projectId/upsell/suggest',
  verifyAuth,
  validate(signalsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof signalsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const suggestions = suggestUpsell(body);
      return res.json({ suggestions });
    } catch (err) {
      logger.error?.('upsell.suggest.error', err);
      captureRouteError(err, 'upsell.suggest');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
