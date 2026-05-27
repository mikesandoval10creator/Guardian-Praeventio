// Praeventio Guard — Safety Metrics OSHA + ICMM HTTP surface.
//
// Sprint K (Fase D.10) — three stateless endpoints over the engine under
// `src/services/safetyMetrics/osha.ts`:
//
//   POST /:projectId/safety-metrics/build-report
//     body: { counts: IncidentCounts, exposure: ExposureInput, periodLabel? }
//     200:  { report: SafetyMetricsReport }
//
//   POST /:projectId/safety-metrics/compare-vs-industry
//     body: { metric: 'trir'|'ltifr', value, industry }
//     200:  { comparison: BenchmarkComparison }
//
//   POST /:projectId/safety-metrics/analyze-trend
//     body: { current, previous, metricKey }
//     200:  { trend: TrendAnalysis }
//
// Pure compute — no Firestore writes. Determinístico, sin LLM.

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
  buildSafetyMetricsReport,
  compareTrirVsIndustry,
  compareLtifrVsIndustry,
  analyzeTrend,
  type IncidentCounts,
  type ExposureInput,
  type SafetyMetricsReport,
  type IndustryBenchmark,
  type TrendAnalysis,
} from '../../services/safetyMetrics/osha.js';

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

const INDUSTRY_BENCHMARKS = [
  'construction_cl',
  'mining_cl',
  'manufacturing_us',
  'oil_gas_us',
  'agriculture_us',
  'transport_cl',
  'all_industries_us',
] as const;

const METRIC_KEYS = [
  'trir',
  'ltifr',
  'dart',
  'sifr',
  'severityRate',
  'frequencyIndex',
  'fatalityRate',
] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. build-report
// ────────────────────────────────────────────────────────────────────────

const incidentCountsSchema = z.object({
  totalRecordable: z.number().nonnegative().max(1_000_000),
  lostTime: z.number().nonnegative().max(1_000_000),
  restrictedOrTransferred: z.number().nonnegative().max(1_000_000),
  seriousInjuriesAndFatalities: z.number().nonnegative().max(1_000_000),
  fatalities: z.number().nonnegative().max(100_000),
  totalLostDays: z.number().nonnegative().max(10_000_000),
}) as unknown as z.ZodType<IncidentCounts>;

const exposureSchema = z.object({
  totalHoursWorked: z.number().nonnegative().max(1e12),
}) as unknown as z.ZodType<ExposureInput>;

const buildReportSchema = z.object({
  counts: incidentCountsSchema,
  exposure: exposureSchema,
  periodLabel: z.string().min(1).max(200).optional(),
});

router.post(
  '/:projectId/safety-metrics/build-report',
  verifyAuth,
  validate(buildReportSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildReportSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildSafetyMetricsReport(body.counts, body.exposure, body.periodLabel);
      return res.json({ report });
    } catch (err) {
      logger.error?.('safetyMetrics.buildReport.error', err);
      captureRouteError(err, 'safetyMetrics.buildReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. compare-vs-industry
// ────────────────────────────────────────────────────────────────────────

const compareSchema = z.object({
  metric: z.enum(['trir', 'ltifr']),
  value: z.number().nonnegative().max(1e9),
  industry: z.enum(INDUSTRY_BENCHMARKS),
});

router.post(
  '/:projectId/safety-metrics/compare-vs-industry',
  verifyAuth,
  validate(compareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof compareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const industry = body.industry as IndustryBenchmark;
      const comparison =
        body.metric === 'trir'
          ? compareTrirVsIndustry(body.value, industry)
          : compareLtifrVsIndustry(body.value, industry);
      return res.json({ comparison });
    } catch (err) {
      logger.error?.('safetyMetrics.compareVsIndustry.error', err);
      captureRouteError(err, 'safetyMetrics.compareVsIndustry');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. analyze-trend
// ────────────────────────────────────────────────────────────────────────

const safetyMetricsReportSchema = z.object({
  trir: z.number(),
  ltifr: z.number(),
  dart: z.number(),
  sifr: z.number(),
  severityRate: z.number(),
  frequencyIndex: z.number(),
  fatalityRate: z.number(),
  totalHoursWorked: z.number().nonnegative(),
  periodLabel: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<SafetyMetricsReport>;

const analyzeTrendSchema = z.object({
  current: safetyMetricsReportSchema,
  previous: safetyMetricsReportSchema,
  metricKey: z.enum(METRIC_KEYS),
});

router.post(
  '/:projectId/safety-metrics/analyze-trend',
  verifyAuth,
  validate(analyzeTrendSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof analyzeTrendSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const trend: TrendAnalysis = analyzeTrend(
        body.current,
        body.previous,
        body.metricKey as TrendAnalysis['metricKey'],
      );
      return res.json({ trend });
    } catch (err) {
      logger.error?.('safetyMetrics.analyzeTrend.error', err);
      captureRouteError(err, 'safetyMetrics.analyzeTrend');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
