// Praeventio Guard — Safety Performance Index (SPI) HTTP surface.
//
// Sprint K §197-198 — two stateless endpoints over the engine under
// `src/services/safetyPerformance/safetyPerformanceIndex.ts`:
//
//   POST /:projectId/safety-performance/compute
//     body: { leading, lagging }
//     200:  { report: SafetyPerformanceReport }
//
//   POST /:projectId/safety-performance/build-trend
//     body: { points }
//     200:  { trend: SpiTrendReport }
//
// Pure compute — no Firestore writes. ISO 45001 leading/lagging blend.

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
  computeSafetyPerformance,
  buildSpiTrend,
  type LeadingIndicators,
  type LaggingIndicators,
  type SpiPeriodPoint,
} from '../../services/safetyPerformance/safetyPerformanceIndex.js';

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
// 1. compute
// ────────────────────────────────────────────────────────────────────────

const leadingSchema = z.object({
  preTaskChecklistCompletion: z.number().min(0).max(1),
  dailyTalksDeliveryRate: z.number().min(0).max(1),
  trainingCurrencyRate: z.number().min(0).max(1),
  plannedInspectionsRate: z.number().min(0).max(1),
  nearMissReportingRate: z.number().nonnegative().max(10_000),
  positiveObservationsRate: z.number().nonnegative().max(10_000),
}) as unknown as z.ZodType<LeadingIndicators>;

const laggingSchema = z.object({
  trir: z.number().nonnegative().max(10_000),
  ltifr: z.number().nonnegative().max(10_000),
  lostDays: z.number().nonnegative().max(10_000_000),
  severityRate: z.number().nonnegative().max(10_000_000),
  regulatoryFindings: z.number().int().nonnegative().max(10_000),
}) as unknown as z.ZodType<LaggingIndicators>;

const computeSchema = z.object({
  leading: leadingSchema,
  lagging: laggingSchema,
});

router.post(
  '/:projectId/safety-performance/compute',
  verifyAuth,
  validate(computeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof computeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = computeSafetyPerformance(body.leading, body.lagging);
      return res.json({ report });
    } catch (err) {
      logger.error?.('safetyPerformance.compute.error', err);
      captureRouteError(err, 'safetyPerformance.compute');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-trend
// ────────────────────────────────────────────────────────────────────────

const periodPointSchema = z.object({
  periodLabel: z.string().min(1).max(200),
  spiScore: z.number().min(0).max(100),
}) as unknown as z.ZodType<SpiPeriodPoint>;

const trendSchema = z.object({
  points: z.array(periodPointSchema).max(1200),
});

router.post(
  '/:projectId/safety-performance/build-trend',
  verifyAuth,
  validate(trendSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof trendSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const trend = buildSpiTrend(body.points);
      return res.json({ trend });
    } catch (err) {
      logger.error?.('safetyPerformance.buildTrend.error', err);
      captureRouteError(err, 'safetyPerformance.buildTrend');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
