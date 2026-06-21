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
// Bucket D (manhours) — two STATEFUL endpoints that make the dashboard real:
//
//   POST /:projectId/safety-metrics/exposure
//     body: { period: 'YYYY-MM', totalHoursWorked: number>=0 }
//     200:  { saved: true, period, totalHoursWorked }
//     Captures the man-hours worked in a period (industry standard input for
//     TRIR/LTIFR). Role-gated (admin/gerente/prevencionista-tier); the server
//     stamps recordedBy/recordedAt from the verified token (NEVER the client).
//     Persisted to `exposure_hours/{projectId}_{period}`; audit-log awaited.
//
//   GET  /:projectId/safety-metrics/report?period=YYYY-MM
//     200:  { counts, exposure, report }
//     Reads the project's REAL incidents for the period, classifies them into
//     IncidentCounts (honest — no fabricated fields), reads the captured
//     exposure_hours (0 if not captured yet), and returns the full report.
//
// The first three endpoints are pure compute — no Firestore writes.
// Determinístico, sin LLM.

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
import {
  classifyIncidents,
  type RawIncidentDoc,
} from '../../services/safetyMetrics/classifyIncidents.js';

const router = Router();

/** Roles allowed to capture the man-hours worked for a period. */
const EXPOSURE_WRITER_ROLES = new Set([
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

// ────────────────────────────────────────────────────────────────────────
// 4. capture exposure (man-hours worked) — STATEFUL
// ────────────────────────────────────────────────────────────────────────

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const exposureCaptureSchema = z.object({
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
  totalHoursWorked: z.number().nonnegative().max(1e12),
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
    logger.warn?.('safetyMetrics.tenant_lookup_failed', err);
  }
  return null;
}

router.post(
  '/:projectId/safety-metrics/exposure',
  verifyAuth,
  validate(exposureCaptureSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof exposureCaptureSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    // Role gate — only prevention/management roles capture man-hours. This is
    // a management-data write (not a life-safety action), so gating is allowed.
    if (!EXPOSURE_WRITER_ROLES.has(callerRole(req))) {
      return res.status(403).json({ error: 'insufficient_role' });
    }

    const db = admin.firestore();
    const docId = `${projectId}_${body.period}`;
    try {
      // Server stamps recordedBy/recordedAt — client-supplied values are
      // ignored entirely (the schema does not even accept them).
      await db.collection('exposure_hours').doc(docId).set(
        {
          projectId,
          period: body.period,
          totalHoursWorked: body.totalHoursWorked,
          recordedBy: callerUid,
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      try {
        await db.collection('audit_logs').add({
          action: 'safety_metrics.exposure.captured',
          module: 'safetyMetrics',
          details: {
            projectId,
            period: body.period,
            totalHoursWorked: body.totalHoursWorked,
          },
          userId: callerUid,
          userEmail: callerEmail,
          projectId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
      } catch (auditErr) {
        logger.error?.('safetyMetrics.exposure.audit_failed', auditErr);
        captureRouteError(auditErr, 'safetyMetrics.exposure.audit');
      }

      return res.json({
        saved: true,
        period: body.period,
        totalHoursWorked: body.totalHoursWorked,
      });
    } catch (err) {
      logger.error?.('safetyMetrics.exposure.error', err);
      captureRouteError(err, 'safetyMetrics.exposure');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. report — read REAL incidents + captured exposure → SafetyMetricsReport
// ────────────────────────────────────────────────────────────────────────

const reportQuerySchema = z.object({
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
});

/** Parse the YYYY-MM `ts`/`occurredAt`/`createdAt` of an incident to a period. */
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

function periodOf(rec: Record<string, unknown>): string | null {
  const iso = tsToIso(rec.ts) ?? tsToIso(rec.occurredAt) ?? tsToIso(rec.createdAt);
  if (!iso || iso.length < 7) return null;
  return iso.slice(0, 7); // 'YYYY-MM'
}

/** Read incidents for the project from BOTH the top-level + nested paths. */
async function readProjectIncidents(
  projectId: string,
  tenantId: string | null,
): Promise<Array<Record<string, unknown>>> {
  const db = admin.firestore();
  const safeRead = async (
    label: string,
    fn: () => Promise<Array<Record<string, unknown>>>,
  ): Promise<Array<Record<string, unknown>>> => {
    try {
      return await fn();
    } catch (err) {
      logger.warn?.(`safetyMetrics.report.${label}.read_failed`, err);
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
  for (const rec of topLevel) {
    const id = String(rec.id ?? '');
    if (id) byId.set(id, rec);
  }
  for (const rec of nested) {
    const id = String(rec.id ?? '');
    if (id && !byId.has(id)) byId.set(id, rec);
  }
  return [...byId.values()];
}

/** Read the captured man-hours for a single period (0 if never captured). */
async function readExposureHours(projectId: string, period: string): Promise<number> {
  try {
    const exSnap = await admin
      .firestore()
      .collection('exposure_hours')
      .doc(`${projectId}_${period}`)
      .get();
    if (exSnap.exists) {
      const raw = (exSnap.data() ?? {}).totalHoursWorked;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
        return raw;
      }
    }
  } catch (err) {
    logger.warn?.('safetyMetrics.exposure_read_failed', err);
  }
  return 0;
}

router.get(
  '/:projectId/safety-metrics/report',
  verifyAuth,
  validate(reportQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const { period } = req.validated as z.infer<typeof reportQuerySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    try {
      const tenantId = await resolveTenantId(projectId);

      // 1. Real incidents of the period → IncidentCounts (honest classify).
      const allIncidents = await readProjectIncidents(projectId, tenantId);
      const inPeriod = allIncidents.filter((rec) => periodOf(rec) === period);
      const counts: IncidentCounts = classifyIncidents(inPeriod as RawIncidentDoc[]);

      // 2. Captured exposure_hours (0 if never captured — honest empty-state).
      const exposure: ExposureInput = {
        totalHoursWorked: await readExposureHours(projectId, period),
      };

      const report = buildSafetyMetricsReport(counts, exposure, period);
      return res.json({ counts, exposure, report });
    } catch (err) {
      logger.error?.('safetyMetrics.report.error', err);
      captureRouteError(err, 'safetyMetrics.report');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. trend — multi-period TRIR/LTIFR/DART/SIFR series (for SafetyTrendChart)
// ────────────────────────────────────────────────────────────────────────
//
//   GET /:projectId/safety-metrics/trend?period=YYYY-MM&months=N
//     200: { points: SafetyTrendPoint[], periods: string[] }
//
// Builds the rolling window of the last N months ending at `period`. Each point
// reuses the SAME honest pipeline as the single-period report: real incidents
// classified into IncidentCounts + the captured man-hours of that month. A
// month with no captured exposure yields rates of 0 (calculateRate returns 0
// when hours <= 0) — never a fabricated value. The chart simply omits points it
// cannot draw; the server never invents exposure or incidents.

const MAX_TREND_MONTHS = 24;
const DEFAULT_TREND_MONTHS = 12;

const trendQuerySchema = z.object({
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
  months: z.coerce.number().int().min(1).max(MAX_TREND_MONTHS).optional(),
});

/** A single period of the trend series (mirrors the client SafetyTrendPoint). */
interface SafetyTrendPoint {
  period: string;
  trir: number;
  ltifr: number;
  dart: number;
  sifr: number;
  /** True only when man-hours were captured for this month (rates are real). */
  hasExposure: boolean;
}

/** Enumerate the last `months` 'YYYY-MM' labels ending at (and including) `end`. */
function rollingPeriods(end: string, months: number): string[] {
  const [y, m] = end.split('-').map((s) => Number.parseInt(s, 10));
  // Anchor at UTC noon on the 1st to avoid TZ/DST drift across month math.
  const anchor = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(anchor);
    d.setUTCMonth(anchor.getUTCMonth() - i);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${d.getUTCFullYear()}-${mm}`);
  }
  return out;
}

router.get(
  '/:projectId/safety-metrics/trend',
  verifyAuth,
  validate(trendQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const { period, months } = req.validated as z.infer<typeof trendQuerySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    try {
      const periods = rollingPeriods(period, months ?? DEFAULT_TREND_MONTHS);
      const tenantId = await resolveTenantId(projectId);

      // Read ALL project incidents once, then bucket by period (avoids N reads).
      const allIncidents = await readProjectIncidents(projectId, tenantId);
      const byPeriod = new Map<string, Array<Record<string, unknown>>>();
      for (const rec of allIncidents) {
        const p = periodOf(rec);
        if (p === null) continue;
        const bucket = byPeriod.get(p);
        if (bucket) bucket.push(rec);
        else byPeriod.set(p, [rec]);
      }

      const points: SafetyTrendPoint[] = await Promise.all(
        periods.map(async (p): Promise<SafetyTrendPoint> => {
          const docs = (byPeriod.get(p) ?? []) as RawIncidentDoc[];
          const counts = classifyIncidents(docs);
          const totalHoursWorked = await readExposureHours(projectId, p);
          const exposure: ExposureInput = { totalHoursWorked };
          const report = buildSafetyMetricsReport(counts, exposure, p);
          return {
            period: p,
            trir: report.trir,
            ltifr: report.ltifr,
            dart: report.dart,
            sifr: report.sifr,
            hasExposure: totalHoursWorked > 0,
          };
        }),
      );

      return res.json({ points, periods });
    } catch (err) {
      logger.error?.('safetyMetrics.trend.error', err);
      captureRouteError(err, 'safetyMetrics.trend');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 7. IPER matrix — read REAL saved iper_assessments → 5×5 matrix nodes
// ────────────────────────────────────────────────────────────────────────
//
//   GET /:projectId/iper-assessments/matrix
//     200: { nodes: RiskMatrixNode[] }
//
// Feeds the executive RiskMatrix5x5 scatter view. Reads the project's REAL
// IPER assessments (collection `iper_assessments`, writer
// src/services/safety/iperAssessments.ts) and projects each into a
// probability × severity node. Read-only (no writes → no audit log). Honest
// empty-state: a project with no assessments returns `{ nodes: [] }`. NEVER
// fabricates a node — only persisted assessments appear.

/** One in [1..5] or null when out of range / not a valid IPER cell. */
function cell1to5(v: unknown): 1 | 2 | 3 | 4 | 5 | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) return null;
  return v as 1 | 2 | 3 | 4 | 5;
}

interface IperMatrixNode {
  id: string;
  label: string;
  probability: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  kind: 'risk';
}

router.get(
  '/:projectId/iper-assessments/matrix',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    const db = admin.firestore();
    try {
      const snap = await db
        .collection('iper_assessments')
        .where('projectId', '==', projectId)
        .get();

      const nodes: IperMatrixNode[] = [];
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const inputs = (data.inputs ?? {}) as Record<string, unknown>;
        const probability = cell1to5(inputs.probability);
        const impact = cell1to5(inputs.severity);
        // Skip malformed/legacy docs rather than fabricating a position.
        if (probability === null || impact === null) continue;
        const description =
          typeof data.description === 'string' && data.description.trim().length > 0
            ? data.description.trim()
            : typeof data.level === 'string' && data.level.length > 0
              ? data.level
              : 'IPER';
        nodes.push({
          id: d.id,
          label: description.length > 80 ? `${description.slice(0, 77)}…` : description,
          probability,
          impact,
          kind: 'risk',
        });
      }

      return res.json({ nodes });
    } catch (err) {
      logger.error?.('safetyMetrics.iperMatrix.error', err);
      captureRouteError(err, 'safetyMetrics.iperMatrix');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
