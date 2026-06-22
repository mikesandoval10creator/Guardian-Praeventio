// SPDX-License-Identifier: MIT
//
// runComplianceSnapshot — daily cron job that snapshots the compliance
// traffic-light state for every project and persists it to
// `compliance_snapshots/{projectId}_{YYYY-MM-DD}`.
//
// Why this job exists:
//   The `GET /api/compliance/:projectId/traffic-light` endpoint already
//   computes a REAL traffic light from the stored project profile (legal
//   obligations, worker count, industry, hazmat flags). But that is a
//   single-point-in-time read — the ExecutiveDashboard and executive
//   scorecard need a time-series of compliance state so they can render
//   a trend. Without daily snapshots, the only "trend" would be a single
//   point (today). This job closes that gap.
//
// Data source (all internal — no external key required):
//   • `projects/{projectId}` — workersCount / industry_code / sectorId /
//     presentRisks / hasHazmat / hasSubcontractors
//   • `computeTrafficLight` pure engine (same logic as the HTTP endpoint)
//   • `applyCoverage` (returns 'unknown' for uncovered categories — never
//     fabricates a green status)
//
// Output collection: `compliance_snapshots`
//   Doc id:   `{projectId}_{YYYY-MM-DD}`
//   Fields:   { projectId, date, capturedAt, result: ComplianceLightView }
//
// Idempotent: re-running on the same day replaces the snapshot for that day
// (last-write-wins semantics via set() without merge).
//
// Mounted as POST /api/maintenance/run-compliance-snapshot via maintenance.ts.
// Cron cadence: daily at 07:00 UTC.

import type { Firestore } from 'firebase-admin/firestore';
import { tracedAsync } from '../../services/observability/tracing.js';
import { logger } from '../../utils/logger.js';
import {
  computeTrafficLight,
  type ComplianceCategory,
} from '../../services/compliance/trafficLightEngine.js';
import { applyCoverage } from '../../services/compliance/trafficLightCoverage.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceSnapshotDoc {
  projectId: string;
  /** Calendar date of this snapshot in `YYYY-MM-DD` (UTC). */
  date: string;
  /** ISO timestamp when the snapshot was captured. */
  capturedAt: string;
  /**
   * Traffic-light result — same shape as `GET /traffic-light` response.
   * Categories not backed by a real data source return 'unknown' (never
   * fabricated green). Currently only 'legal' is fully wired server-side.
   */
  result: ReturnType<typeof applyCoverage>;
  /** Profile fields used as input (for auditability). */
  profile: {
    workersCount: number;
    industry?: string;
    hasHazmat?: boolean;
    hasSubcontractors?: boolean;
  };
}

export interface RunComplianceSnapshotResult {
  /** Number of projects scanned (all active projects). */
  projectsScanned: number;
  /** Snapshots successfully written. */
  snapshotsWritten: number;
  /** Errors encountered (non-fatal: other projects continue). */
  errors: number;
}

export interface RunComplianceSnapshotDeps {
  db: Firestore;
  /** Override clock for tests. */
  now?: () => Date;
  /** Max projects per run. Default 500. */
  projectLimit?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Industry code → GP-* sector mapping (mirrors compliance.ts route).
const INDUSTRY_TO_SECTOR: Record<string, string> = {
  mining: 'GP-MIN',
  construction: 'GP-CONS',
  energy: 'GP-ELEC',
};

function resolveSector(data: Record<string, unknown>): string | undefined {
  if (typeof data.sectorId === 'string' && /^GP-/.test(data.sectorId)) {
    return data.sectorId;
  }
  if (
    typeof data.industry_code === 'string' &&
    INDUSTRY_TO_SECTOR[data.industry_code]
  ) {
    return INDUSTRY_TO_SECTOR[data.industry_code];
  }
  return undefined;
}

// ── Main job ─────────────────────────────────────────────────────────────────

/**
 * Snapshot the compliance traffic-light state for every project.
 *
 * Per-project failures are non-fatal — they are logged and the job
 * continues with remaining projects.
 */
export async function runComplianceSnapshot(
  deps: RunComplianceSnapshotDeps,
): Promise<RunComplianceSnapshotResult> {
  return tracedAsync(
    'job.compliance_snapshot',
    {},
    () => runComplianceSnapshotInner(deps),
  );
}

async function runComplianceSnapshotInner(
  deps: RunComplianceSnapshotDeps,
): Promise<RunComplianceSnapshotResult> {
  const { db } = deps;
  const now = deps.now ? deps.now() : new Date();
  const projectLimit = deps.projectLimit ?? 500;
  const capturedAt = now.toISOString();

  // Date key: YYYY-MM-DD in UTC.
  const date = now.toISOString().slice(0, 10);

  const result: RunComplianceSnapshotResult = {
    projectsScanned: 0,
    snapshotsWritten: 0,
    errors: 0,
  };

  let projectsSnap;
  try {
    projectsSnap = await db.collection('projects').limit(projectLimit).get();
  } catch (err) {
    logger.error('compliance_snapshot.projects_query_failed', {
      err: String(err),
    });
    result.errors += 1;
    return result;
  }

  for (const projectDoc of projectsSnap.docs) {
    const projectId = projectDoc.id;
    result.projectsScanned += 1;

    try {
      const data = (projectDoc.data() ?? {}) as Record<string, unknown>;

      // Build the REAL profile from stored project fields — identical to
      // the HTTP endpoint. Missing fields omitted (never fabricated).
      const profile = {
        workersCount:
          typeof data.workersCount === 'number' ? data.workersCount : 0,
        industry: resolveSector(data),
        presentRisks: Array.isArray(data.presentRisks)
          ? data.presentRisks.filter((r): r is string => typeof r === 'string')
          : undefined,
        hasHazmat:
          typeof data.hasHazmat === 'boolean' ? data.hasHazmat : undefined,
        hasSubcontractors:
          typeof data.hasSubcontractors === 'boolean'
            ? data.hasSubcontractors
            : undefined,
      };

      // Compute the traffic light — same call as the HTTP route.
      const engineResult = computeTrafficLight({
        profile,
        expirableItems: [],
        attendedLegalRuleIds: [],
        openFindings: [],
      });

      // Only 'legal' is backed by a real data source today; other categories
      // return 'unknown'. This is identical to the HTTP endpoint's honesty
      // contract — snapshot must not be more optimistic than the live view.
      const sourced = new Set<ComplianceCategory>(['legal']);
      const view = applyCoverage(engineResult, sourced);

      const snapshotDoc: ComplianceSnapshotDoc = {
        projectId,
        date,
        capturedAt,
        result: view,
        profile: {
          workersCount: profile.workersCount,
          industry: profile.industry,
          hasHazmat: profile.hasHazmat,
          hasSubcontractors: profile.hasSubcontractors,
        },
      };

      const docId = `${projectId}_${date}`;
      await db.collection('compliance_snapshots').doc(docId).set(snapshotDoc);

      result.snapshotsWritten += 1;
      logger.info('compliance_snapshot.project_done', {
        projectId,
        date,
        overallStatus: view.overall,
      });
    } catch (err) {
      logger.error('compliance_snapshot.project_failed', {
        projectId,
        date,
        err: String(err),
      });
      result.errors += 1;
    }
  }

  return result;
}
