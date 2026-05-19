// Praeventio Guard — Prevention Cost Calculator HTTP surface.
//
// Sprint 39 J.3 (§117-118) — two stateless endpoints over the engine
// under `src/services/costCalculator/preventionCostCalculator.ts`:
//
//   POST /:projectId/cost-calculator/non-compliance
//     body: NonComplianceInput
//     200:  { estimate: NonComplianceEstimate }
//
//   POST /:projectId/cost-calculator/prevention-roi
//     body: PreventionROIInput
//     200:  { estimate: PreventionROIEstimate }
//
// Pure compute — no Firestore writes. Estimaciones en CLP basadas en
// Ley 16.744 + Código del Trabajo art. 477 + SUSESO/DT publications.

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
  estimateNonComplianceCost,
  estimatePreventionROI,
  type NonComplianceInput,
  type PreventionROIInput,
  type IncompletionKind,
} from '../../services/costCalculator/preventionCostCalculator.js';

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

const KINDS: readonly IncompletionKind[] = [
  'document_missing',
  'training_overdue',
  'epp_expired',
  'safety_breach',
  'fatal_accident_risk',
];

// ────────────────────────────────────────────────────────────────────────
// 1. non-compliance
// ────────────────────────────────────────────────────────────────────────

const nonComplianceSchema = z.object({
  kind: z.enum(KINDS as readonly [IncompletionKind, ...IncompletionKind[]]),
  affectedWorkerCount: z.number().int().nonnegative().max(1_000_000),
  estimatedStoppageDays: z.number().nonnegative().max(3650),
  dailyStoppageCostClp: z.number().nonnegative().max(1e12),
  adminHoursToFix: z.number().nonnegative().max(100_000),
  adminHourlyCostClp: z.number().positive().max(1e9).optional(),
  hasHistoryOfFines: z.boolean(),
}) as unknown as z.ZodType<NonComplianceInput>;

router.post(
  '/:projectId/cost-calculator/non-compliance',
  verifyAuth,
  validate(nonComplianceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof nonComplianceSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const estimate = estimateNonComplianceCost(body);
      return res.json({ estimate });
    } catch (err) {
      logger.error?.('costCalculator.nonCompliance.error', err);
      captureRouteError(err, 'costCalculator.nonCompliance');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. prevention-roi
// ────────────────────────────────────────────────────────────────────────

const roiSchema = z.object({
  expirationsCaughtEarly: z.number().int().nonnegative().max(1_000_000),
  adminHoursSaved: z.number().nonnegative().max(1_000_000),
  adminHourlyCostClp: z.number().positive().max(1e9).optional(),
  documentsGeneratedInternally: z.number().int().nonnegative().max(1_000_000),
  externalDocCostClp: z.number().positive().max(1e9).optional(),
  potentialStoppagesAvoided: z.number().int().nonnegative().max(1_000_000),
  avgStoppageCostClp: z.number().positive().max(1e12).optional(),
  nearMissesNotEscalated: z.number().int().nonnegative().max(1_000_000),
  avgIncidentCostClp: z.number().positive().max(1e12).optional(),
}) as unknown as z.ZodType<PreventionROIInput>;

router.post(
  '/:projectId/cost-calculator/prevention-roi',
  verifyAuth,
  validate(roiSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof roiSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const estimate = estimatePreventionROI(body);
      return res.json({ estimate });
    } catch (err) {
      logger.error?.('costCalculator.preventionRoi.error', err);
      captureRouteError(err, 'costCalculator.preventionRoi');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
