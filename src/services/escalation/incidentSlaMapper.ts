// Praeventio Guard — HONEST bridge: registered incident docs → SLA WorkflowItems.
//
// The SlaWatchPanel needs `AssessedItem[]` whose age + severity come from REAL
// data. A registered incident doc (see services/incidents/incidentRagService.ts)
// carries genuine `createdAt`/`ts` timestamps and a real `severity` — exactly
// the inputs `assessSla` needs to put a meaningful clock on the item.
//
// Honest by construction:
//   - no real timestamp on the doc → the item is SKIPPED (we never stamp
//     `new Date()`, which would make every item look brand-new and forever
//     within_sla — the cascarón bug this module replaces).
//   - closed/rejected incidents are SKIPPED (no live SLA clock).
//   - the incident severity scale (low|med|high|critical) is mapped to the
//     engine scale (low|medium|high|critical|sif); `med` → `medium`.
//
// Pure function — deterministic, no Firestore reads, no side effects.

import type {
  WorkflowItem,
  SeverityLevel,
} from './escalationSlaEngine.js';

/** Minimal subset of a registered incident doc we read. Unknown-safe. */
export interface RawIncidentDoc {
  id?: unknown;
  severity?: unknown;
  status?: unknown;
  createdAt?: unknown;
  ts?: unknown;
  occurredAt?: unknown;
  description?: unknown;
}

/** Map the incident severity scale to the SLA-engine severity scale. */
function mapSeverity(raw: unknown): SeverityLevel | null {
  switch (raw) {
    case 'low':
      return 'low';
    case 'med':
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'critical':
      return 'critical';
    case 'sif':
      return 'sif';
    default:
      return null;
  }
}

/** Parse a Firestore timestamp-ish value into an ISO string, or null. */
function toIso(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length >= 10) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
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

const CLOSED_STATES = new Set(['closed', 'rejected', 'resolved', 'verified']);

/** A workflow item plus the label the panel renders for it. */
export interface IncidentWorkflowItem {
  item: WorkflowItem;
  label: string;
}

/**
 * Convert ONE raw incident doc into a WorkflowItem (+label), or null when the
 * doc lacks the real inputs needed for an honest SLA clock.
 */
export function incidentDocToWorkflowItem(
  doc: RawIncidentDoc,
): IncidentWorkflowItem | null {
  const id = typeof doc.id === 'string' && doc.id.length > 0 ? doc.id : null;
  if (!id) return null;

  const severity = mapSeverity(doc.severity);
  if (!severity) return null;

  // Real timestamp only — never fabricate `new Date()`.
  const createdAt = toIso(doc.createdAt) ?? toIso(doc.ts) ?? toIso(doc.occurredAt);
  if (!createdAt) return null;

  // Live SLA clock only for incidents still requiring action.
  const rawStatus = typeof doc.status === 'string' ? doc.status : 'open';
  if (CLOSED_STATES.has(rawStatus)) return null;
  const status: WorkflowItem['status'] =
    rawStatus === 'in_progress' || rawStatus === 'pending_review'
      ? rawStatus
      : 'open';

  const label =
    typeof doc.description === 'string' && doc.description.trim().length > 0
      ? doc.description.trim()
      : id;

  return {
    item: {
      id,
      kind: 'incident',
      severity,
      status,
      createdAt,
    },
    label,
  };
}

/**
 * Fold an array of raw incident docs into the honest WorkflowItem list,
 * dropping any doc without the real inputs (timestamp/severity) or already
 * closed. Deterministic; no fabricated fields.
 */
export function incidentDocsToWorkflowItems(
  docs: ReadonlyArray<RawIncidentDoc>,
): IncidentWorkflowItem[] {
  const out: IncidentWorkflowItem[] = [];
  for (const doc of docs) {
    const mapped = incidentDocToWorkflowItem(doc);
    if (mapped) out.push(mapped);
  }
  return out;
}
