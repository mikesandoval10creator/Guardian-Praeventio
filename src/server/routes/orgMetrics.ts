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

/** Roles allowed to capture workforce figures for a period. Mirrors the
 *  exposure-hours writer set in safetyMetrics.ts — this is management data
 *  (not a life-safety action), so server-side role gating is allowed (#11). */
const WORKFORCE_WRITER_ROLES = new Set([
  'admin',
  'gerente',
  'supervisor',
  'prevencionista',
  'director_obra',
  'medico_ocupacional',
]);

function callerRole(req: import('express').Request): string {
  const role = (req.user as { role?: string } | undefined)?.role;
  return typeof role === 'string' ? role : '';
}

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

// ────────────────────────────────────────────────────────────────────────
// 6. capture workforce period (absenteeism + overtime + headcount) — STATEFUL
// ────────────────────────────────────────────────────────────────────────
//
// Captures the per-period workforce figures that the computeOperationalPressure
// engine derives its workforce-pressure signals from. Persisted to
// `workforce_periods/{projectId}_{YYYY-MM}`; role-gated; the server stamps
// recordedBy/recordedAt from the verified token (the schema does NOT accept
// those fields from the client). Audit-log awaited (#3/#14).

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const workforceCaptureSchema = z.object({
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
  /** Total person-days of absence accumulated across the workforce in the period. */
  absenteeismDays: z.number().nonnegative().max(1_000_000),
  /** Total overtime hours worked across the whole workforce in the period. */
  overtimeHours: z.number().nonnegative().max(10_000_000),
  /** Active workers (headcount) in the period. */
  headcount: z.number().int().nonnegative().max(10_000_000),
});

router.post(
  '/:projectId/workforce-period',
  verifyAuth,
  validate(workforceCaptureSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof workforceCaptureSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    // Role gate — only prevention/management roles capture workforce figures.
    // Management data (not a life-safety action), so gating is allowed (#11).
    if (!WORKFORCE_WRITER_ROLES.has(callerRole(req))) {
      return res.status(403).json({ error: 'insufficient_role' });
    }

    const db = admin.firestore();
    const docId = `${projectId}_${body.period}`;
    try {
      // Server stamps recordedBy/recordedAt — client-supplied values are
      // ignored entirely (the schema does not even accept them).
      await db.collection('workforce_periods').doc(docId).set(
        {
          projectId,
          period: body.period,
          absenteeismDays: body.absenteeismDays,
          overtimeHours: body.overtimeHours,
          headcount: body.headcount,
          recordedBy: callerUid,
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      try {
        await db.collection('audit_logs').add({
          action: 'org_metrics.workforce_period.captured',
          module: 'orgMetrics',
          details: {
            projectId,
            period: body.period,
            absenteeismDays: body.absenteeismDays,
            overtimeHours: body.overtimeHours,
            headcount: body.headcount,
          },
          userId: callerUid,
          userEmail: callerEmail,
          projectId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
      } catch (auditErr) {
        logger.error?.('orgMetrics.workforcePeriod.audit_failed', auditErr);
        captureRouteError(auditErr, 'orgMetrics.workforcePeriod.audit');
      }

      return res.json({
        saved: true,
        period: body.period,
        absenteeismDays: body.absenteeismDays,
        overtimeHours: body.overtimeHours,
        headcount: body.headcount,
      });
    } catch (err) {
      logger.error?.('orgMetrics.workforcePeriod.error', err);
      captureRouteError(err, 'orgMetrics.workforcePeriod');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 7. operational-pressure — read captured workforce period → PressureReport
// ────────────────────────────────────────────────────────────────────────
//
// Reads the captured workforce_periods doc, derives the workforce-pressure
// signals HONESTLY, and runs the REAL computeOperationalPressure engine. The
// signals the engine accepts but we do NOT capture in this collection
// (overdueTasks, minorIncidentsLast7d, hasNightShift, hasAdverseWeather) are
// left at their honest neutral value (0 / false) rather than fabricated — the
// gauge therefore reflects ONLY the workforce strain we actually measured.

const operationalPressureQuerySchema = z.object({
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
});

/** Standard person-days worked per month per worker (≈ 30 cal days × 6/7
 *  worked) — used to turn absence person-days into a 0-1 absenteeism rate. */
const WORKDAYS_PER_MONTH = 26;
/** Weeks in a month, to spread monthly overtime back to a weekly total. */
const WEEKS_PER_MONTH = 4.345;

/** Derive the engine's PressureSignals from a captured workforce period.
 *  Pure — no fabrication: only the three workforce signals are populated. */
function deriveSignals(doc: {
  absenteeismDays: number;
  overtimeHours: number;
  headcount: number;
}): PressureSignals {
  const headcount = doc.headcount;
  const absenteeismRate =
    headcount > 0
      ? Math.min(doc.absenteeismDays / (headcount * WORKDAYS_PER_MONTH), 1)
      : 0;
  const overtimeHoursWeekTotal = doc.overtimeHours / WEEKS_PER_MONTH;
  return {
    overdueTasks: 0, // not captured here — honest neutral
    overtimeHoursWeekTotal,
    minorIncidentsLast7d: 0, // not captured here — honest neutral
    absenteeismRate,
    hasNightShift: false, // not captured here — honest neutral
    hasAdverseWeather: false, // not captured here — honest neutral
    totalActiveWorkers: headcount,
  };
}

router.get(
  '/:projectId/operational-pressure',
  verifyAuth,
  validate(operationalPressureQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const { period } = req.validated as z.infer<typeof operationalPressureQuerySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    const db = admin.firestore();
    try {
      const snap = await db
        .collection('workforce_periods')
        .doc(`${projectId}_${period}`)
        .get();

      // Honest empty-state: nothing captured for the period yet.
      if (!snap.exists) {
        return res.json({ captured: false, period, signals: null, report: null });
      }

      const data = snap.data() ?? {};
      const absenteeismDays =
        typeof data.absenteeismDays === 'number' && Number.isFinite(data.absenteeismDays)
          ? Math.max(data.absenteeismDays, 0)
          : 0;
      const overtimeHours =
        typeof data.overtimeHours === 'number' && Number.isFinite(data.overtimeHours)
          ? Math.max(data.overtimeHours, 0)
          : 0;
      const headcount =
        typeof data.headcount === 'number' && Number.isFinite(data.headcount)
          ? Math.max(Math.trunc(data.headcount), 0)
          : 0;

      const signals = deriveSignals({ absenteeismDays, overtimeHours, headcount });
      const report = computeOperationalPressure(signals);
      return res.json({
        captured: true,
        period,
        workforce: { absenteeismDays, overtimeHours, headcount },
        signals,
        report,
      });
    } catch (err) {
      logger.error?.('orgMetrics.operationalPressure.error', err);
      captureRouteError(err, 'orgMetrics.operationalPressure');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
