// Praeventio Guard — Contractors KPI + Acreditación HTTP surface.
//
// Sprint K §47-48 + §90-91 — three stateless endpoints over the engine
// under `src/services/contractors/contractorKpiService.ts`:
//
//   POST /:projectId/contractors/compute-kpi              { perf }
//   POST /:projectId/contractors/rank-by-risk             { perfs }
//   POST /:projectId/contractors/acreditation-gap-report  { record, nowIso? }
//
// Pure compute — no Firestore writes. TRIR/LTIFR/severity rate
// computed per industry-standard constants (200,000 / 1,000,000).
//
// Contractor man-hours (manhours per contractor) — two STATEFUL endpoints
// that make the contractor-performance dashboard real (mirrors the
// `exposure_hours` keystone in safetyMetrics.ts, scoped by contractorId):
//
//   POST /:projectId/contractors/exposure
//     body: { contractorId, contractorName, period: 'YYYY-MM', totalHoursWorked }
//     200:  { saved: true, contractorId, period, totalHoursWorked }
//     Captures the man-hours worked by ONE contractor in a period. Role-gated
//     (admin/gerente/prevencionista-tier); the server stamps
//     recordedBy/recordedAt from the verified token (NEVER the client).
//     Persisted to `contractor_exposure_hours/{projectId}_{contractorId}_{YYYY-MM}`;
//     audit-log awaited.
//
//   GET  /:projectId/contractors/performance?period=YYYY-MM
//     200:  { period, contractors: ContractorPerformanceRow[] }
//     For each contractor with captured exposure hours, reads the project's
//     REAL incidents of the period attributed to that contractor (incidents
//     carrying a `contractorId` — honest: incidents without one are NOT
//     fabricated onto any contractor), classifies them via the OSHA engine,
//     and returns the per-contractor TRIR/LTIFR. Empty when nothing captured.

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
  computeContractorKpi,
  rankContractorsByRisk,
  buildAcreditationGapReport,
  type ContractorPerformance,
  type AcreditationRecord,
  type AcreditationStatus,
} from '../../services/contractors/contractorKpiService.js';
import {
  buildSafetyMetricsReport,
  type IncidentCounts,
  type SafetyMetricsReport,
} from '../../services/safetyMetrics/osha.js';
import {
  classifyIncidents,
  type RawIncidentDoc,
} from '../../services/safetyMetrics/classifyIncidents.js';

const router = Router();

/** Roles allowed to capture contractor man-hours (management data, not life-safety). */
const CONTRACTOR_EXPOSURE_WRITER_ROLES = new Set([
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

const ACREDITATION_STATUSES: readonly AcreditationStatus[] = [
  'pending',
  'in_review',
  'approved',
  'observed',
  'rejected',
];

const perfSchema = z.object({
  contractorId: z.string().min(1).max(200),
  legalName: z.string().min(1).max(500),
  manDaysWorked: z.number().nonnegative().max(10_000_000),
  manHoursWorked: z.number().nonnegative().max(1_000_000_000),
  recordableIncidents: z.number().int().nonnegative().max(1_000_000),
  lostTimeDays: z.number().nonnegative().max(10_000_000),
  overdueActions: z.number().int().nonnegative().max(1_000_000),
  trainingCompletionRate: z.number().min(0).max(1),
  documentationCurrentRate: z.number().min(0).max(1),
}) as unknown as z.ZodType<ContractorPerformance>;

// ────────────────────────────────────────────────────────────────────────
// 1. compute-kpi
// ────────────────────────────────────────────────────────────────────────

const computeSchema = z.object({
  perf: perfSchema,
});

router.post(
  '/:projectId/contractors/compute-kpi',
  verifyAuth,
  validate(computeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof computeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const kpi = computeContractorKpi(body.perf);
      return res.json({ kpi });
    } catch (err) {
      logger.error?.('contractors.computeKpi.error', err);
      captureRouteError(err, 'contractors.computeKpi');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. rank-by-risk
// ────────────────────────────────────────────────────────────────────────

const rankSchema = z.object({
  perfs: z.array(perfSchema).max(10_000),
});

router.post(
  '/:projectId/contractors/rank-by-risk',
  verifyAuth,
  validate(rankSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rankSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ranking = rankContractorsByRisk(body.perfs);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('contractors.rankByRisk.error', err);
      captureRouteError(err, 'contractors.rankByRisk');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. acreditation-gap-report
// ────────────────────────────────────────────────────────────────────────

const observationSchema = z.object({
  id: z.string().min(1).max(200),
  issue: z.string().min(1).max(2000),
  dueAt: z.string().min(10),
  resolved: z.boolean(),
  resolvedAt: z.string().min(10).optional(),
});

const recordSchema = z.object({
  contractorId: z.string().min(1).max(200),
  status: z.enum(ACREDITATION_STATUSES as readonly [AcreditationStatus, ...AcreditationStatus[]]),
  observations: z.array(observationSchema).max(1000),
  lastReviewedAt: z.string().min(10).optional(),
}) as unknown as z.ZodType<AcreditationRecord>;

const acreditationSchema = z.object({
  record: recordSchema,
  nowIso: z.string().min(10).optional(),
});

router.post(
  '/:projectId/contractors/acreditation-gap-report',
  verifyAuth,
  validate(acreditationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof acreditationSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildAcreditationGapReport(body.record, body.nowIso);
      return res.json({ report });
    } catch (err) {
      logger.error?.('contractors.acreditationGapReport.error', err);
      captureRouteError(err, 'contractors.acreditationGapReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. capture contractor exposure (man-hours per contractor) — STATEFUL
// ────────────────────────────────────────────────────────────────────────

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * A contractorId is part of the Firestore docId (`{projectId}_{contractorId}_
 * {period}`), so it must not contain a `/` (path separator). Disallowing it
 * keeps the id well-formed and prevents collection-traversal.
 */
const contractorExposureCaptureSchema = z.object({
  contractorId: z.string().min(1).max(200).regex(/^[^/]+$/, 'contractorId cannot contain "/"'),
  contractorName: z.string().min(1).max(500),
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
  totalHoursWorked: z.number().nonnegative().max(1e12),
});

router.post(
  '/:projectId/contractors/exposure',
  verifyAuth,
  validate(contractorExposureCaptureSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof contractorExposureCaptureSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    // Role gate — management data (not a life-safety action), so gating is
    // allowed per CLAUDE.md #11.
    if (!CONTRACTOR_EXPOSURE_WRITER_ROLES.has(callerRole(req))) {
      return res.status(403).json({ error: 'insufficient_role' });
    }

    const db = admin.firestore();
    const docId = `${projectId}_${body.contractorId}_${body.period}`;
    try {
      // Server stamps recordedBy/recordedAt — the schema does not accept them
      // from the client, so they can never be forged.
      await db.collection('contractor_exposure_hours').doc(docId).set(
        {
          projectId,
          contractorId: body.contractorId,
          contractorName: body.contractorName,
          period: body.period,
          totalHoursWorked: body.totalHoursWorked,
          recordedBy: callerUid,
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      try {
        await db.collection('audit_logs').add({
          action: 'contractors.exposure.captured',
          module: 'contractors',
          details: {
            projectId,
            contractorId: body.contractorId,
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
        logger.error?.('contractors.exposure.audit_failed', auditErr);
        captureRouteError(auditErr, 'contractors.exposure.audit');
      }

      return res.json({
        saved: true,
        contractorId: body.contractorId,
        period: body.period,
        totalHoursWorked: body.totalHoursWorked,
      });
    } catch (err) {
      logger.error?.('contractors.exposure.error', err);
      captureRouteError(err, 'contractors.exposure');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. performance — per-contractor TRIR/LTIFR from REAL incidents + exposure
// ────────────────────────────────────────────────────────────────────────

const performanceQuerySchema = z.object({
  period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'),
});

/** Per-contractor row consumed by the contractor-performance dashboard. */
export interface ContractorPerformanceRow {
  contractorId: string;
  contractorName: string;
  totalHoursWorked: number;
  counts: IncidentCounts;
  report: SafetyMetricsReport;
}

/** Resolve tenantId from the project doc (incidents may be nested under it). */
async function resolveTenantId(projectId: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection('projects').doc(projectId).get();
    const data = snap.exists ? snap.data() : null;
    if (data && typeof data.tenantId === 'string' && data.tenantId.length > 0) {
      return data.tenantId;
    }
  } catch (err) {
    logger.warn?.('contractors.tenant_lookup_failed', err);
  }
  return null;
}

/** Parse a string / Firestore-timestamp `ts`-like value into an ISO string. */
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

/** Honest contractor attribution: ONLY a real `contractorId` on the doc. */
function incidentContractorId(rec: Record<string, unknown>): string | null {
  const cid = rec.contractorId;
  return typeof cid === 'string' && cid.length > 0 ? cid : null;
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
      logger.warn?.(`contractors.performance.${label}.read_failed`, err);
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

router.get(
  '/:projectId/contractors/performance',
  verifyAuth,
  validate(performanceQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const { period } = req.validated as z.infer<typeof performanceQuerySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    const db = admin.firestore();
    try {
      // 1. Captured contractor exposure for the period (the dashboard's roster).
      const exSnap = await db
        .collection('contractor_exposure_hours')
        .where('projectId', '==', projectId)
        .where('period', '==', period)
        .get();

      const exposures = exSnap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .filter((d) => typeof d.contractorId === 'string' && (d.contractorId as string).length > 0);

      // Honest empty-state: nothing captured → empty roster (no fake rows).
      if (exposures.length === 0) {
        return res.json({ period, contractors: [] as ContractorPerformanceRow[] });
      }

      // 2. Real incidents of the period, grouped by their REAL contractorId.
      const tenantId = await resolveTenantId(projectId);
      const allIncidents = await readProjectIncidents(projectId, tenantId);
      const inPeriod = allIncidents.filter((rec) => periodOf(rec) === period);
      const incidentsByContractor = new Map<string, Array<Record<string, unknown>>>();
      for (const rec of inPeriod) {
        const cid = incidentContractorId(rec);
        if (!cid) continue; // never fabricate attribution
        const list = incidentsByContractor.get(cid) ?? [];
        list.push(rec);
        incidentsByContractor.set(cid, list);
      }

      // 3. Per-contractor TRIR/LTIFR via the REAL OSHA engine.
      const contractors: ContractorPerformanceRow[] = exposures
        .map((ex) => {
          const contractorId = ex.contractorId as string;
          const contractorName =
            typeof ex.contractorName === 'string' && ex.contractorName.length > 0
              ? ex.contractorName
              : contractorId;
          const rawHours = ex.totalHoursWorked;
          const totalHoursWorked =
            typeof rawHours === 'number' && Number.isFinite(rawHours) && rawHours >= 0
              ? rawHours
              : 0;
          const incidents = (incidentsByContractor.get(contractorId) ?? []) as RawIncidentDoc[];
          const counts = classifyIncidents(incidents);
          const report = buildSafetyMetricsReport(counts, { totalHoursWorked }, period);
          return { contractorId, contractorName, totalHoursWorked, counts, report };
        })
        .sort((a, b) => b.report.trir - a.report.trir);

      return res.json({ period, contractors });
    } catch (err) {
      logger.error?.('contractors.performance.error', err);
      captureRouteError(err, 'contractors.performance');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
