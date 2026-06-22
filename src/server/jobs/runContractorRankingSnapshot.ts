// SPDX-License-Identifier: MIT
//
// runContractorRankingSnapshot — daily cron job that aggregates per-contractor
// TRIR/LTIFR for the current month across all projects and persists a ranked
// snapshot to `contractor_ranking_snapshots/{projectId}_{YYYY-MM}`.
//
// Data source (all internal — no external key required):
//   • `contractor_exposure_hours/{projectId}_{contractorId}_{YYYY-MM}` (man-hours)
//   • `incidents` (top-level, projectId-filtered) + nested
//     `tenants/{tid}/projects/{pid}/incidents` (honest attribution via contractorId)
//
// Output collection: `contractor_ranking_snapshots`
//   Doc id:   `{projectId}_{YYYY-MM}`
//   Fields:   { projectId, period, capturedAt, contractors: ContractorRankEntry[] }
//
// Used by ContractorRankingTable (src/components/contractors/ContractorRankingTable.tsx)
// and the executive scorecard surface. The snapshot is idempotent: re-running for the
// same period updates the doc (most-recent data wins).
//
// Mounted as POST /api/maintenance/run-contractor-ranking-snapshot via maintenance.ts.
// Cron cadence: daily at 06:00 UTC (captures data as-of current month YTD).

import type { Firestore } from 'firebase-admin/firestore';
import { tracedAsync } from '../../services/observability/tracing.js';
import { logger } from '../../utils/logger.js';
import {
  rankContractorsByRisk,
  type ContractorPerformance,
  type ContractorRankEntry,
} from '../../services/contractors/contractorKpiService.js';
import {
  buildSafetyMetricsReport,
} from '../../services/safetyMetrics/osha.js';
import {
  classifyIncidents,
  type RawIncidentDoc,
} from '../../services/safetyMetrics/classifyIncidents.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContractorRankingSnapshotDoc {
  projectId: string;
  /** Reporting period as `YYYY-MM`. */
  period: string;
  /** ISO timestamp of when the snapshot was produced. */
  capturedAt: string;
  /**
   * Ranked contractor rows — sorted descending by riskScore.
   * Empty when no contractor man-hours have been captured for the period.
   */
  contractors: (ContractorRankEntry & {
    trir: number;
    ltifr: number;
    totalHoursWorked: number;
    totalRecordable: number;
  })[];
}

export interface RunContractorRankingSnapshotResult {
  /** Projects scanned (those that have at least one exposure record). */
  projectsScanned: number;
  /** Total snapshot docs written (one per project with data). */
  snapshotsWritten: number;
  /** Total snapshot docs skipped because no man-hours captured. */
  snapshotsSkipped: number;
  /** Errors encountered (non-fatal: other projects continue). */
  errors: number;
}

export interface RunContractorRankingSnapshotDeps {
  db: Firestore;
  /** Override the reporting period (default: current month as YYYY-MM). */
  period?: string;
  /** Override clock for tests. */
  now?: () => Date;
  /** Max projects to scan per run. Default 500. */
  projectLimit?: number;
  /** Max exposure records per project. Default 200. */
  exposureLimit?: number;
  /** Max incidents per project collection. Default 5000. */
  incidentLimit?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a string / Firestore-timestamp value into ISO string, or null. */
function tsToIso(raw: unknown): string | null {
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object') {
    const t = raw as { toDate?: () => Date; _seconds?: number; seconds?: number };
    if (typeof t.toDate === 'function') {
      const d = t.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
    }
    const secs =
      typeof t._seconds === 'number'
        ? t._seconds
        : typeof t.seconds === 'number'
          ? t.seconds
          : null;
    if (secs !== null) {
      const d = new Date(secs * 1000);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

/** Extract the YYYY-MM from a raw incident document. */
function periodOf(rec: Record<string, unknown>): string | null {
  const iso =
    tsToIso(rec.ts) ?? tsToIso(rec.occurredAt) ?? tsToIso(rec.createdAt);
  if (!iso || iso.length < 7) return null;
  return iso.slice(0, 7);
}

/** Honest contractor attribution: only a real `contractorId` on the doc. */
function incidentContractorId(rec: Record<string, unknown>): string | null {
  const cid = rec.contractorId;
  return typeof cid === 'string' && cid.length > 0 ? cid : null;
}

/** Read incidents for a project from top-level + nested tenant path. */
async function readProjectIncidents(
  db: Firestore,
  projectId: string,
  tenantId: string | null,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const safeRead = async (
    label: string,
    fn: () => Promise<Array<Record<string, unknown>>>,
  ): Promise<Array<Record<string, unknown>>> => {
    try {
      return await fn();
    } catch (err) {
      logger.warn(`contractor_ranking_snapshot.${label}.read_failed`, {
        projectId,
        err: String(err),
      });
      return [];
    }
  };

  const [topLevel, nested] = await Promise.all([
    safeRead('incidents_top', async () => {
      const snap = await db
        .collection('incidents')
        .where('projectId', '==', projectId)
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
      }));
    }),
    tenantId
      ? safeRead('incidents_nested', async () => {
          const snap = await db
            .collection(`tenants/${tenantId}/projects/${projectId}/incidents`)
            .limit(limit)
            .get();
          return snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          }));
        })
      : Promise.resolve([] as Array<Record<string, unknown>>),
  ]);

  // Deduplicate by id (nested path may overlap with top-level).
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

// ── Main job ─────────────────────────────────────────────────────────────────

/**
 * Aggregates per-contractor TRIR/LTIFR for the given period across all
 * projects that have captured man-hours data, and writes ranked snapshots.
 *
 * Returns counts for the HTTP wrapper. Errors on individual projects are
 * non-fatal — they are logged, counted, and the job continues with
 * remaining projects.
 */
export async function runContractorRankingSnapshot(
  deps: RunContractorRankingSnapshotDeps,
): Promise<RunContractorRankingSnapshotResult> {
  return tracedAsync(
    'job.contractor_ranking_snapshot',
    { period: deps.period ?? 'current-month' },
    () => runContractorRankingSnapshotInner(deps),
  );
}

async function runContractorRankingSnapshotInner(
  deps: RunContractorRankingSnapshotDeps,
): Promise<RunContractorRankingSnapshotResult> {
  const { db } = deps;
  const now = deps.now ? deps.now() : new Date();
  const projectLimit = deps.projectLimit ?? 500;
  const exposureLimit = deps.exposureLimit ?? 200;
  const incidentLimit = deps.incidentLimit ?? 5000;
  const capturedAt = now.toISOString();

  // Default period = current UTC month (YYYY-MM).
  const period =
    deps.period ??
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const result: RunContractorRankingSnapshotResult = {
    projectsScanned: 0,
    snapshotsWritten: 0,
    snapshotsSkipped: 0,
    errors: 0,
  };

  // Enumerate projects by querying contractor_exposure_hours for the period
  // (only projects with exposure data are relevant — avoids iterating ALL
  // projects for a pipeline that has no output for projects without data).
  let exposureSnap;
  try {
    exposureSnap = await db
      .collection('contractor_exposure_hours')
      .where('period', '==', period)
      .limit(projectLimit * exposureLimit)
      .get();
  } catch (err) {
    logger.error('contractor_ranking_snapshot.exposure_query_failed', {
      period,
      err: String(err),
    });
    result.errors += 1;
    return result;
  }

  // Group exposure records by projectId.
  const byProject = new Map<
    string,
    Array<{
      contractorId: string;
      contractorName: string;
      totalHoursWorked: number;
    }>
  >();

  for (const doc of exposureSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const projectId =
      typeof d.projectId === 'string' && d.projectId.length > 0 ? d.projectId : null;
    const contractorId =
      typeof d.contractorId === 'string' && d.contractorId.length > 0
        ? d.contractorId
        : null;
    if (!projectId || !contractorId) continue;

    const contractorName =
      typeof d.contractorName === 'string' && d.contractorName.length > 0
        ? d.contractorName
        : contractorId;
    const totalHoursWorked =
      typeof d.totalHoursWorked === 'number' &&
      Number.isFinite(d.totalHoursWorked) &&
      d.totalHoursWorked >= 0
        ? d.totalHoursWorked
        : 0;

    const list = byProject.get(projectId) ?? [];
    list.push({ contractorId, contractorName, totalHoursWorked });
    byProject.set(projectId, list);
  }

  // Process each project that has exposure data.
  for (const [projectId, exposures] of byProject.entries()) {
    result.projectsScanned += 1;

    if (exposures.length === 0) {
      result.snapshotsSkipped += 1;
      continue;
    }

    try {
      // Resolve tenantId from the project doc (for nested incidents).
      let tenantId: string | null = null;
      try {
        const projectSnap = await db.collection('projects').doc(projectId).get();
        if (projectSnap.exists) {
          const pd = projectSnap.data() as Record<string, unknown>;
          if (typeof pd.tenantId === 'string' && pd.tenantId.trim().length > 0) {
            tenantId = pd.tenantId.trim();
          }
        }
      } catch (err) {
        logger.warn('contractor_ranking_snapshot.tenant_lookup_failed', {
          projectId,
          err: String(err),
        });
      }

      // Read all incidents for the project for the period.
      const allIncidents = await readProjectIncidents(
        db,
        projectId,
        tenantId,
        incidentLimit,
      );
      const inPeriod = allIncidents.filter(
        (rec) => periodOf(rec) === period,
      );

      // Group incidents by their REAL contractorId (honest: skip unattributed).
      const incidentsByContractor = new Map<
        string,
        Array<Record<string, unknown>>
      >();
      for (const rec of inPeriod) {
        const cid = incidentContractorId(rec);
        if (!cid) continue;
        const list = incidentsByContractor.get(cid) ?? [];
        list.push(rec);
        incidentsByContractor.set(cid, list);
      }

      // Build per-contractor performance inputs for the ranking engine.
      const perfs: ContractorPerformance[] = exposures.map((ex) => {
        const incidents = (incidentsByContractor.get(ex.contractorId) ??
          []) as RawIncidentDoc[];
        const counts = classifyIncidents(incidents);
        const report = buildSafetyMetricsReport(
          counts,
          { totalHoursWorked: ex.totalHoursWorked },
          period,
        );
        return {
          contractorId: ex.contractorId,
          legalName: ex.contractorName,
          manDaysWorked: 0, // exposure hours are the primary unit
          manHoursWorked: ex.totalHoursWorked,
          recordableIncidents: counts.totalRecordable,
          lostTimeDays: counts.lostTime,
          // These are not stored per-period yet; honest defaults.
          overdueActions: 0,
          trainingCompletionRate: 0,
          documentationCurrentRate: 0,
          // Annotate with computed rates for the snapshot.
          _trir: report.trir,
          _ltifr: report.ltifr,
          _totalRecordable: counts.totalRecordable,
        } as unknown as ContractorPerformance;
      });

      const ranked: ContractorRankEntry[] = rankContractorsByRisk(perfs);

      // Build the full snapshot rows (join back the rates).
      const contractorsWithRates = ranked.map((entry) => {
        const perf = perfs.find((p) => p.contractorId === entry.contractorId);
        const p = perf as unknown as {
          _trir: number;
          _ltifr: number;
          _totalRecordable: number;
          manHoursWorked: number;
        };
        return {
          ...entry,
          trir: p?._trir ?? 0,
          ltifr: p?._ltifr ?? 0,
          totalHoursWorked: p?.manHoursWorked ?? 0,
          totalRecordable: p?._totalRecordable ?? 0,
        };
      });

      const docId = `${projectId}_${period}`;
      const snapshotDoc: ContractorRankingSnapshotDoc = {
        projectId,
        period,
        capturedAt,
        contractors: contractorsWithRates,
      };

      await db
        .collection('contractor_ranking_snapshots')
        .doc(docId)
        .set(snapshotDoc);

      result.snapshotsWritten += 1;
      logger.info('contractor_ranking_snapshot.project_done', {
        projectId,
        period,
        contractorCount: contractorsWithRates.length,
      });
    } catch (err) {
      logger.error('contractor_ranking_snapshot.project_failed', {
        projectId,
        period,
        err: String(err),
      });
      result.errors += 1;
    }
  }

  return result;
}
