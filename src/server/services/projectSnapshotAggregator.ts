// Praeventio Guard — Project snapshot aggregator (READ-side pipeline P1).
//
// Builds the `ProjectSnapshot` shape consumed by the Project Comparator engine
// (`src/services/projectComparator/projectComparator.ts:25`) from the REAL
// per-project Firestore collections. This is the read-side that DEEP-EX-34 H3
// flagged as missing: `ProjectsCompare` used to receive an empty `snapshots`
// prop because nothing ever aggregated these KPIs server-side.
//
// Field shapes verified against the existing aggregators (canonical references):
//   • incidents       → insights.ts:427 / role-view (where projectId)
//   • findings        → insights.ts:341 (status === 'open' = abierto)
//   • risks           → insights.ts:259-302 (severity/criticidad/severidad)
//   • audits          → cphsMinute.ts:472-497 (status completado/completada/…)
//   • corrective_actions → insights.ts:419-424 (status 'open', dueDate string)
//
// Pure compute over already-fetched doc arrays — no Firestore reach-in here so
// it stays unit-testable. The route fetches; this module counts + normalizes.

import type { ProjectSnapshot } from '../../services/projectComparator/projectComparator.js';

/** Minimal doc-data shape: a plain record. */
export type DocLike = Record<string, unknown>;

/** Raw collections fetched for a single project. */
export interface ProjectCollections {
  incidents: DocLike[];
  findings: DocLike[];
  audits: DocLike[];
  risks: DocLike[];
  correctiveActions: DocLike[];
}

/** Project header fields needed for the snapshot (from `projects/{id}`). */
export interface ProjectHeader {
  projectId: string;
  projectName: string;
  workersCount: number;
}

// ── Field-level helpers (mirror the canonical aggregators) ────────────────

/** Critical-severity tokens — same set insights.ts uses for findings/risks. */
const CRITICAL_SEVERITY = new Set(['high', 'critical', 'alto', 'crítico']);
const CRITICAL_CRITICIDAD = new Set(['Crítica', 'Alta']);

/** A finding is "open" when its status is not a closed/resolved token. */
function isOpenFinding(doc: DocLike): boolean {
  const status = typeof doc.status === 'string' ? doc.status.toLowerCase() : '';
  // Mirror insights.ts safety-talks which filters status === 'open'. Treat any
  // non-closed/resolved status as open so legacy docs without status count
  // (the comparator must not under-report open findings).
  return status !== 'closed' && status !== 'cerrado' && status !== 'cerrada' && status !== 'resolved' && status !== 'resuelto';
}

/** A risk is "critical" — mirrors insights.ts risk-timeseries classification. */
function isCriticalRisk(doc: DocLike): boolean {
  const meta = (doc.metadata as DocLike | undefined) ?? {};
  const severity = String(doc.severity ?? meta.severity ?? '').toLowerCase();
  const criticidad = String(meta.criticidad ?? doc.criticidad ?? '');
  const severidadRaw = meta.severidad ?? doc.severidad;
  const severidad = typeof severidadRaw === 'number' ? severidadRaw : 0;
  return (
    CRITICAL_SEVERITY.has(severity) ||
    CRITICAL_CRITICIDAD.has(criticidad) ||
    severidad >= 4
  );
}

/** An audit is "completed" — mirrors cphsMinute.ts isCompletedStatus. */
function isCompletedAudit(doc: DocLike): boolean {
  const raw = doc.status;
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

/**
 * A corrective action was closed "on time" — the field that CANNOT be derived
 * client-side (the comparator's whole reason for needing this server pipeline,
 * per READ-PIPELINES-SPEC.md P1). A CA counts as on-time when it is closed AND
 * its closure date is on/before its due date. `dueDate` is a string date
 * (insights.ts role-view uses `dueDate < today`). Closure date is read from
 * `closedAt` with `resolvedAt`/`completedAt` fallbacks (legacy field drift).
 */
function correctiveActionClosedOnTime(doc: DocLike): boolean | null {
  const status = typeof doc.status === 'string' ? doc.status.toLowerCase() : '';
  const isClosed = status === 'closed' || status === 'cerrado' || status === 'cerrada' || status === 'completed' || status === 'completado' || status === 'completada' || status === 'resolved' || status === 'resuelto';
  if (!isClosed) return null; // not closed → not part of the on-time ratio
  const closedRaw = doc.closedAt ?? doc.resolvedAt ?? doc.completedAt;
  const dueRaw = doc.dueDate;
  const closedMs = typeof closedRaw === 'string' ? Date.parse(closedRaw) : NaN;
  const dueMs = typeof dueRaw === 'string' ? Date.parse(dueRaw) : NaN;
  if (!Number.isFinite(closedMs) || !Number.isFinite(dueMs)) {
    // Closed but no comparable dates → can't judge punctuality. Count it as a
    // closed action that we cannot confirm late, so treat as on-time (the
    // honest default: closed work is good; missing dates aren't a penalty).
    return true;
  }
  return closedMs <= dueMs;
}

// ── Aggregation ───────────────────────────────────────────────────────────

/**
 * Compute one `ProjectSnapshot` from a project's header + raw collections.
 * Returns metrics as REAL counts — a project with no data yields honest zeros
 * (auditCompliancePct / correctiveActionsOnTimePct default to 100 when there
 * is nothing to measure, since "no overdue work" is the truthful baseline, not
 * a fabricated value).
 */
export function buildProjectSnapshot(
  header: ProjectHeader,
  collections: ProjectCollections,
  snapshotAt: string,
): ProjectSnapshot {
  const incidentCount = collections.incidents.length;
  const openFindingsCount = collections.findings.filter(isOpenFinding).length;
  const criticalRisksCount = collections.risks.filter(isCriticalRisk).length;

  const totalAudits = collections.audits.length;
  const completedAudits = collections.audits.filter(isCompletedAudit).length;
  const auditCompliancePct =
    totalAudits === 0 ? 100 : Math.round((completedAudits / totalAudits) * 100);

  const onTimeJudgements = collections.correctiveActions
    .map(correctiveActionClosedOnTime)
    .filter((v): v is boolean => v !== null);
  const onTimeCount = onTimeJudgements.filter(Boolean).length;
  const correctiveActionsOnTimePct =
    onTimeJudgements.length === 0
      ? 100
      : Math.round((onTimeCount / onTimeJudgements.length) * 100);

  return {
    projectId: header.projectId,
    projectName: header.projectName,
    snapshotAt,
    metrics: {
      incidentCount,
      openFindingsCount,
      auditCompliancePct,
      criticalRisksCount,
      workersCount: header.workersCount,
      correctiveActionsOnTimePct,
    },
  };
}
