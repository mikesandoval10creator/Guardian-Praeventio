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
// The first two endpoints are pure compute — no Firestore writes.
//
// SPI plan-vs-executed (STATEFUL) — two endpoints that make the SpiDashboard real:
//
//   POST /:projectId/safety-performance/safety-plan
//     body: { period: 'YYYY-MM', plannedInspections, plannedDailyTalks,
//             plannedTrainings }
//     200:  { saved: true, period, ...counts }
//     Captures the PLANNED counts of a period — the DENOMINATORS for the
//     leading indicators (executed ÷ planned). Role-gated (admin/gerente/
//     prevencionista-tier); the server stamps recordedBy/recordedAt from the
//     verified token (NEVER the client). Persisted to
//     `safety_plan_periods/{projectId}_{period}`; audit-log awaited.
//
//   GET  /:projectId/safety-performance/spi-report?period=YYYY-MM
//     200:  { report, leading, lagging, honesty, ratios, plan }
//     Computes the SafetyPerformanceReport via the REAL engine:
//       LEADING  = executed (read from REAL operational collections of the
//                  period) ÷ planned (from safety_plan_periods). Honest-empty
//                  per indicator when no plan was captured.
//       LAGGING  = exposure_hours + classified incidents → TRIR/LTIFR via the
//                  OSHA engine (reuses the safetyMetrics keystone sources).
//
// ISO 45001 leading/lagging blend. Determinístico, sin LLM.

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
import {
  foldLeadingIndicators,
  type ExecutedCounts,
  type PlannedCounts,
} from '../../services/safetyPerformance/spiInputs.js';
import {
  buildSafetyMetricsReport,
  type ExposureInput,
} from '../../services/safetyMetrics/osha.js';
import {
  classifyIncidents,
  type RawIncidentDoc,
} from '../../services/safetyMetrics/classifyIncidents.js';

const router = Router();

/** Roles allowed to capture the planned counts for a period. */
const PLAN_WRITER_ROLES = new Set([
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

// ────────────────────────────────────────────────────────────────────────
// 3. capture safety plan (planned counts of a period) — STATEFUL
// ────────────────────────────────────────────────────────────────────────

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const safetyPlanSchema = z.object({
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
  plannedInspections: z.number().int().nonnegative().max(100_000),
  plannedDailyTalks: z.number().int().nonnegative().max(100_000),
  plannedTrainings: z.number().int().nonnegative().max(100_000),
});

router.post(
  '/:projectId/safety-performance/safety-plan',
  verifyAuth,
  validate(safetyPlanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof safetyPlanSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    // Role gate — only prevention/management roles capture planned counts.
    // This is a management-data write (not a life-safety action), so gating is
    // allowed (CLAUDE.md #11).
    if (!PLAN_WRITER_ROLES.has(callerRole(req))) {
      return res.status(403).json({ error: 'insufficient_role' });
    }

    const db = admin.firestore();
    const docId = `${projectId}_${body.period}`;
    try {
      // Server stamps recordedBy/recordedAt — client-supplied values are
      // ignored entirely (the schema does not even accept them).
      await db.collection('safety_plan_periods').doc(docId).set(
        {
          projectId,
          period: body.period,
          plannedInspections: body.plannedInspections,
          plannedDailyTalks: body.plannedDailyTalks,
          plannedTrainings: body.plannedTrainings,
          recordedBy: callerUid,
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      try {
        await db.collection('audit_logs').add({
          action: 'safety_performance.plan.captured',
          module: 'safetyPerformance',
          details: {
            projectId,
            period: body.period,
            plannedInspections: body.plannedInspections,
            plannedDailyTalks: body.plannedDailyTalks,
            plannedTrainings: body.plannedTrainings,
          },
          userId: callerUid,
          userEmail: callerEmail,
          projectId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
      } catch (auditErr) {
        logger.error?.('safetyPerformance.plan.audit_failed', auditErr);
        captureRouteError(auditErr, 'safetyPerformance.plan.audit');
      }

      return res.json({
        saved: true,
        period: body.period,
        plannedInspections: body.plannedInspections,
        plannedDailyTalks: body.plannedDailyTalks,
        plannedTrainings: body.plannedTrainings,
      });
    } catch (err) {
      logger.error?.('safetyPerformance.plan.error', err);
      captureRouteError(err, 'safetyPerformance.plan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. spi-report — REAL executed ÷ captured planned + lagging → SPI
// ────────────────────────────────────────────────────────────────────────

const spiReportQuerySchema = z.object({
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
});

/** Resolve tenantId from the project doc (incidents may be nested under it). */
async function resolveTenantId(projectId: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection('projects').doc(projectId).get();
    const data = snap.exists ? snap.data() : null;
    if (data && typeof data.tenantId === 'string' && data.tenantId.length > 0) {
      return data.tenantId;
    }
  } catch (err) {
    logger.warn?.('safetyPerformance.tenant_lookup_failed', err);
  }
  return null;
}

/** Parse a Firestore ts/string/Timestamp into an ISO string, or null. */
function tsToIso(raw: unknown): string | null {
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object') {
    const t = raw as { toDate?: () => Date; _seconds?: number; seconds?: number };
    if (typeof t.toDate === 'function') {
      const d = t.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
    }
    const seconds =
      typeof t._seconds === 'number'
        ? t._seconds
        : typeof t.seconds === 'number'
          ? t.seconds
          : null;
    if (seconds !== null) {
      const d = new Date(seconds * 1000);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

function periodMatches(raw: unknown, period: string): boolean {
  const iso = tsToIso(raw);
  return typeof iso === 'string' && iso.length >= 7 && iso.slice(0, 7) === period;
}

function isCompletedStatus(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const s = raw.toLowerCase();
  return (
    s === 'completado' ||
    s === 'completada' ||
    s === 'completed' ||
    s === 'ejecutada' ||
    s === 'ejecutado'
  );
}

async function safeCount(
  label: string,
  fn: () => Promise<number>,
): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    logger.warn?.(`safetyPerformance.spiReport.${label}.read_failed`, err);
    return 0;
  }
}

/** Read REAL executed counts for the period from the operational collections. */
async function readExecutedCounts(
  projectId: string,
  period: string,
): Promise<ExecutedCounts> {
  const db = admin.firestore();

  const [executedInspections, executedDailyTalks, executedTrainings, nearMissReports] =
    await Promise.all([
      // Executed inspections/audits of the period.
      safeCount('inspections', async () => {
        const snap = await db
          .collection('audits')
          .where('projectId', '==', projectId)
          .limit(2000)
          .get();
        return snap.docs.filter((d) => {
          const data = d.data() as Record<string, unknown>;
          return (
            isCompletedStatus(data.status) &&
            (periodMatches(data.completedAt, period) ||
              periodMatches(data.date, period) ||
              periodMatches(data.createdAt, period))
          );
        }).length;
      }),
      // Executed daily talks of the period (subcollection keyed by date).
      safeCount('dailyTalks', async () => {
        const snap = await db
          .collection(`projects/${projectId}/safety_talks_given`)
          .limit(2000)
          .get();
        return snap.docs.filter((d) => {
          const data = d.data() as Record<string, unknown>;
          return (
            periodMatches(data.date, period) ||
            periodMatches(data.givenAt, period) ||
            periodMatches(data.createdAt, period)
          );
        }).length;
      }),
      // Executed (completed) trainings of the period.
      safeCount('trainings', async () => {
        const snap = await db
          .collection('training')
          .where('projectId', '==', projectId)
          .limit(2000)
          .get();
        return snap.docs.filter((d) => {
          const data = d.data() as Record<string, unknown>;
          return (
            isCompletedStatus(data.status) &&
            (periodMatches(data.completedAt, period) ||
              periodMatches(data.date, period) ||
              periodMatches(data.createdAt, period))
          );
        }).length;
      }),
      // Near-miss reports of the period (a real raw culture-rate count).
      safeCount('nearMiss', async () => {
        const snap = await db
          .collection('incidents')
          .where('projectId', '==', projectId)
          .limit(5000)
          .get();
        return snap.docs.filter((d) => {
          const data = d.data() as Record<string, unknown>;
          if (data.incidentType !== 'near_miss') return false;
          return (
            periodMatches(data.ts, period) ||
            periodMatches(data.occurredAt, period) ||
            periodMatches(data.createdAt, period)
          );
        }).length;
      }),
    ]);

  return { executedInspections, executedDailyTalks, executedTrainings, nearMissReports };
}

/** Read the captured planned counts for the period, or null if none captured. */
async function readPlannedCounts(
  projectId: string,
  period: string,
): Promise<PlannedCounts | null> {
  try {
    const snap = await admin
      .firestore()
      .collection('safety_plan_periods')
      .doc(`${projectId}_${period}`)
      .get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    return {
      plannedInspections: Number(data.plannedInspections ?? 0),
      plannedDailyTalks: Number(data.plannedDailyTalks ?? 0),
      plannedTrainings: Number(data.plannedTrainings ?? 0),
    };
  } catch (err) {
    logger.warn?.('safetyPerformance.spiReport.plan_read_failed', err);
    return null;
  }
}

/** Read REAL incidents of the period → IncidentCounts (honest classify). */
async function readIncidentCounts(
  projectId: string,
  period: string,
  tenantId: string | null,
): Promise<ReturnType<typeof classifyIncidents>> {
  const db = admin.firestore();
  const safeRead = async (
    label: string,
    fn: () => Promise<Array<Record<string, unknown>>>,
  ): Promise<Array<Record<string, unknown>>> => {
    try {
      return await fn();
    } catch (err) {
      logger.warn?.(`safetyPerformance.spiReport.${label}.read_failed`, err);
      return [];
    }
  };

  const [topLevel, nested] = await Promise.all([
    safeRead('incidents_top', async () => {
      const snap = await db.collection('incidents').where('projectId', '==', projectId).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    }),
    tenantId
      ? safeRead('incidents_nested', async () => {
          const snap = await db
            .collection(`tenants/${tenantId}/projects/${projectId}/incidents`)
            .get();
          return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
        })
      : Promise.resolve([] as Array<Record<string, unknown>>),
  ]);

  const byId = new Map<string, Record<string, unknown>>();
  for (const rec of [...topLevel, ...nested]) {
    const id = String(rec.id ?? '');
    if (id && !byId.has(id)) byId.set(id, rec);
  }
  const inPeriod = [...byId.values()].filter(
    (rec) =>
      periodMatches(rec.ts, period) ||
      periodMatches(rec.occurredAt, period) ||
      periodMatches(rec.createdAt, period),
  );
  return classifyIncidents(inPeriod as RawIncidentDoc[]);
}

router.get(
  '/:projectId/safety-performance/spi-report',
  verifyAuth,
  validate(spiReportQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const { period } = req.validated as z.infer<typeof spiReportQuerySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    const db = admin.firestore();
    try {
      const tenantId = await resolveTenantId(projectId);

      // LEADING — real executed ÷ captured planned (honest-empty per indicator).
      const [executed, planned] = await Promise.all([
        readExecutedCounts(projectId, period),
        readPlannedCounts(projectId, period),
      ]);
      const fold = foldLeadingIndicators(executed, planned);

      // LAGGING — exposure_hours + classified incidents → TRIR/LTIFR (OSHA).
      let totalHoursWorked = 0;
      try {
        const exSnap = await db
          .collection('exposure_hours')
          .doc(`${projectId}_${period}`)
          .get();
        if (exSnap.exists) {
          const raw = (exSnap.data() ?? {}).totalHoursWorked;
          if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
            totalHoursWorked = raw;
          }
        }
      } catch (err) {
        logger.warn?.('safetyPerformance.spiReport.exposure_read_failed', err);
      }
      const exposure: ExposureInput = { totalHoursWorked };
      const counts = await readIncidentCounts(projectId, period, tenantId);
      const metrics = buildSafetyMetricsReport(counts, exposure, period);

      const lagging: LaggingIndicators = {
        trir: metrics.trir,
        ltifr: metrics.ltifr,
        lostDays: counts.totalLostDays,
        severityRate: metrics.severityRate,
        regulatoryFindings: 0,
      };
      // Lagging is honest-empty (rate-wise) when no exposure was captured —
      // TRIR/LTIFR need man-hours, so without them the lagging score is not
      // grounded in a real rate.
      const laggingHonestyEmpty = totalHoursWorked <= 0;

      const report = computeSafetyPerformance(fold.leading, lagging);

      return res.json({
        period,
        report,
        leading: fold.leading,
        lagging,
        honesty: {
          ...fold.honesty,
          laggingEmpty: laggingHonestyEmpty,
        },
        ratios: fold.ratios,
        plan: planned,
        exposure,
        counts,
      });
    } catch (err) {
      logger.error?.('safetyPerformance.spiReport.error', err);
      captureRouteError(err, 'safetyPerformance.spiReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
