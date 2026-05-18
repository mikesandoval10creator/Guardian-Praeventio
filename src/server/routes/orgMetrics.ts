// Praeventio Guard — Organizational Metrics HTTP surface.
//
// Sprint K §278-283 — five stateless endpoints over the engine under
// `src/services/orgMetrics/organizationalMetrics.ts`:
//
//   POST /:projectId/org-metrics/detect-silos
//     body: { signals }
//     200:  { reports: SiloReport[] }
//
//   POST /:projectId/org-metrics/build-friction-report
//     body: { samples }
//     200:  { reports: FrictionReport[] }
//
//   POST /:projectId/org-metrics/build-closure-time-report
//     body: { gaps }
//     200:  { reports: ClosureTimeReport[] }
//
//   POST /:projectId/org-metrics/detect-chronic-gaps
//     body: { history }
//     200:  { reports: ChronicGap[] }
//
//   POST /:projectId/org-metrics/compute-operational-pressure
//     body: { signals }
//     200:  { report: PressureReport }
//
// Pure compute — no Firestore writes. All five reads consolidate state
// captured upstream; the engine measures system behavior, not the worker.

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
  detectSilos,
  buildFrictionReport,
  buildClosureTimeReport,
  detectChronicGaps,
  computeOperationalPressure,
  type ModuleSignal,
  type AdminFlowSample,
  type ClosedGap,
  type GapHistory,
  type PressureSignals,
} from '../../services/orgMetrics/organizationalMetrics.js';

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

const ADMIN_PROCESSES = [
  'doc_approval',
  'action_closure',
  'incident_review',
  'certificate_validation',
  'contractor_onboarding',
] as const;

const GAP_KINDS = [
  'critical_action',
  'document_observation',
  'inspection_finding',
  'training_gap',
] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. detect-silos
// ────────────────────────────────────────────────────────────────────────

const moduleSignalSchema = z.object({
  module: z.string().min(1).max(200),
  outboundEvents: z.number().int().nonnegative().max(10_000_000),
  inboundEvents: z.number().int().nonnegative().max(10_000_000),
  expectedPeers: z.array(z.string().min(1).max(200)).max(200),
  actualPeers: z.array(z.string().min(1).max(200)).max(200),
}) as unknown as z.ZodType<ModuleSignal>;

const siloSchema = z.object({
  signals: z.array(moduleSignalSchema).max(200),
});

router.post(
  '/:projectId/org-metrics/detect-silos',
  verifyAuth,
  validate(siloSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof siloSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const reports = detectSilos(body.signals);
      return res.json({ reports });
    } catch (err) {
      logger.error?.('orgMetrics.detectSilos.error', err);
      captureRouteError(err, 'orgMetrics.detectSilos');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-friction-report
// ────────────────────────────────────────────────────────────────────────

const adminFlowSampleSchema = z.object({
  process: z.enum(ADMIN_PROCESSES),
  flowId: z.string().min(1).max(200),
  startedAt: z.string().min(10),
  completedAt: z.string().min(10).optional(),
  isStuck: z.boolean(),
}) as unknown as z.ZodType<AdminFlowSample>;

const frictionSchema = z.object({
  samples: z.array(adminFlowSampleSchema).max(50_000),
});

router.post(
  '/:projectId/org-metrics/build-friction-report',
  verifyAuth,
  validate(frictionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof frictionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const reports = buildFrictionReport(body.samples);
      return res.json({ reports });
    } catch (err) {
      logger.error?.('orgMetrics.buildFrictionReport.error', err);
      captureRouteError(err, 'orgMetrics.buildFrictionReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. build-closure-time-report
// ────────────────────────────────────────────────────────────────────────

const closedGapSchema = z.object({
  kind: z.enum(GAP_KINDS),
  openedAt: z.string().min(10),
  closedAt: z.string().min(10),
}) as unknown as z.ZodType<ClosedGap>;

const closureSchema = z.object({
  gaps: z.array(closedGapSchema).max(50_000),
});

router.post(
  '/:projectId/org-metrics/build-closure-time-report',
  verifyAuth,
  validate(closureSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof closureSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const reports = buildClosureTimeReport(body.gaps);
      return res.json({ reports });
    } catch (err) {
      logger.error?.('orgMetrics.buildClosureTimeReport.error', err);
      captureRouteError(err, 'orgMetrics.buildClosureTimeReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. detect-chronic-gaps
// ────────────────────────────────────────────────────────────────────────

const gapHistorySchema = z.object({
  location: z.string().min(1).max(300),
  category: z.string().min(1).max(200),
  inspectionAt: z.string().min(10),
  foundProblem: z.boolean(),
}) as unknown as z.ZodType<GapHistory>;

const chronicSchema = z.object({
  history: z.array(gapHistorySchema).max(50_000),
});

router.post(
  '/:projectId/org-metrics/detect-chronic-gaps',
  verifyAuth,
  validate(chronicSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof chronicSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const reports = detectChronicGaps(body.history);
      return res.json({ reports });
    } catch (err) {
      logger.error?.('orgMetrics.detectChronicGaps.error', err);
      captureRouteError(err, 'orgMetrics.detectChronicGaps');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. compute-operational-pressure
// ────────────────────────────────────────────────────────────────────────

const pressureSignalsSchema = z.object({
  overdueTasks: z.number().int().nonnegative().max(1_000_000),
  overtimeHoursWeekTotal: z.number().nonnegative().max(1_000_000),
  minorIncidentsLast7d: z.number().int().nonnegative().max(1_000_000),
  absenteeismRate: z.number().min(0).max(1),
  hasNightShift: z.boolean(),
  hasAdverseWeather: z.boolean(),
  totalActiveWorkers: z.number().int().nonnegative().max(10_000_000),
}) as unknown as z.ZodType<PressureSignals>;

const pressureSchema = z.object({
  signals: pressureSignalsSchema,
});

router.post(
  '/:projectId/org-metrics/compute-operational-pressure',
  verifyAuth,
  validate(pressureSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof pressureSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = computeOperationalPressure(body.signals);
      return res.json({ report });
    } catch (err) {
      logger.error?.('orgMetrics.computeOperationalPressure.error', err);
      captureRouteError(err, 'orgMetrics.computeOperationalPressure');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
