// Praeventio Guard — Sprint 41 F.30 event collector.
//
// Bridges the canonical operational collections (incidents, training,
// inspections, permits, corrective_actions, SOS, micro-training,
// audit-exports) to the TelemetryEvent shape `aggregator.ts` expects.
//
// 100% privacy-preserving: every projection drops PII fields (workerUid,
// fullName, RUT, email, phone) BEFORE the event reaches the aggregator.
// `assertNoPII` from aggregator.ts is the second line of defense.
//
// Pure read — no writes, no transforms beyond shape projection.

import type {
  TelemetryEvent,
  TelemetryEventKind,
} from './aggregator.js';

export interface CollectorFirestoreDb {
  collection(path: string): any;
}

/** Severity normalization: legacy/Spanish/short forms map to the canonical 4. */
function normalizeSeverity(
  raw: unknown,
): TelemetryEvent['severity'] | undefined {
  if (typeof raw !== 'string') return undefined;
  const k = raw.trim().toLowerCase();
  if (k === 'low' || k === 'baja') return 'low';
  if (k === 'medium' || k === 'med' || k === 'media') return 'medium';
  if (k === 'high' || k === 'alta') return 'high';
  if (k === 'critical' || k === 'critica' || k === 'crítica' || k === 'sif')
    return 'critical';
  return undefined;
}

function pickIsoTimestamp(data: Record<string, unknown>): string | null {
  // Try the canonical fields used across our collections.
  const candidates = [
    data.occurredAt,
    data.ts,
    data.createdAt,
    data.timestamp,
    data.completedAt,
    data.startedAt,
    data.issuedAt,
    data.signedAt,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length >= 10) return c;
    // Firestore Timestamp shape
    if (c && typeof c === 'object') {
      const t = c as { toDate?: () => Date; seconds?: number; _seconds?: number };
      if (typeof t.toDate === 'function') {
        const d = t.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
      }
      const seconds = typeof t._seconds === 'number' ? t._seconds : t.seconds;
      if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString();
    }
  }
  return null;
}

function projectionToEvent(
  id: string,
  kind: TelemetryEventKind,
  projectId: string,
  data: Record<string, unknown>,
  tenantId?: string,
): TelemetryEvent | null {
  const occurredAt = pickIsoTimestamp(data);
  if (!occurredAt) return null;
  const severity = normalizeSeverity(
    data.severity ?? data.threatLevel ?? data.priority,
  );
  return {
    id,
    kind,
    occurredAt,
    projectId,
    tenantId,
    severity,
  };
}

export interface CollectInputs {
  projectId: string;
  tenantId: string;
  /** Lookback in days; events older than this are skipped client-side. */
  lookbackDays: number;
  /** Hard cap on docs read per collection (defense in depth). */
  maxPerCollection?: number;
  now?: Date;
}

interface CollectionSource {
  /** Firestore collection path. */
  path: string;
  /** Which TelemetryEventKind these docs project to. */
  kind: TelemetryEventKind;
  /** Filter applied to scope per-tenant + per-project. */
  scope: 'top_level_projectId' | 'tenant_scoped';
}

/**
 * The canonical sources to aggregate. Each ships a projection from its
 * native shape to the TelemetryEvent contract. New event kinds can be
 * registered here without touching the aggregator or the route.
 */
function getSources(tenantId: string, projectId: string): CollectionSource[] {
  return [
    {
      path: `incidents`,
      kind: 'incident_recorded',
      scope: 'top_level_projectId',
    },
    {
      path: `tenants/${tenantId}/projects/${projectId}/inspections`,
      kind: 'inspection_done',
      scope: 'tenant_scoped',
    },
    {
      path: `tenants/${tenantId}/projects/${projectId}/work_permits`,
      kind: 'permit_issued',
      scope: 'tenant_scoped',
    },
    {
      path: `tenants/${tenantId}/projects/${projectId}/corrective_actions`,
      kind: 'corrective_action_opened',
      scope: 'tenant_scoped',
    },
    {
      path: `tenants/${tenantId}/projects/${projectId}/microtraining_sessions`,
      kind: 'micro_training_passed',
      scope: 'tenant_scoped',
    },
    {
      path: `tenants/${tenantId}/projects/${projectId}/audit_exports`,
      kind: 'audit_export',
      scope: 'tenant_scoped',
    },
  ];
}

/**
 * Read all sources in parallel and project to TelemetryEvent[]. Failures
 * on any single source are swallowed (collection might not yet exist on
 * a new project) — the aggregator handles partial inputs gracefully.
 */
export async function collectEvents(
  db: CollectorFirestoreDb,
  input: CollectInputs,
): Promise<TelemetryEvent[]> {
  const now = input.now ?? new Date();
  const startMs = now.getTime() - input.lookbackDays * 86_400_000;
  const startIso = new Date(startMs).toISOString();
  const cap = input.maxPerCollection ?? 500;
  const sources = getSources(input.tenantId, input.projectId);

  const results = await Promise.all(
    sources.map(async (src) => {
      try {
        let query = db.collection(src.path);
        if (src.scope === 'top_level_projectId') {
          query = query.where('projectId', '==', input.projectId);
        }
        const snap = await query.limit(cap).get();
        const events: TelemetryEvent[] = [];
        for (const doc of snap.docs) {
          const data = doc.data() as Record<string, unknown>;
          const ev = projectionToEvent(
            doc.id,
            src.kind,
            input.projectId,
            data,
            input.tenantId,
          );
          if (!ev) continue;
          if (Date.parse(ev.occurredAt) < Date.parse(startIso)) continue;
          events.push(ev);
        }
        return events;
      } catch {
        // Collection missing or query error — skip this source.
        return [] as TelemetryEvent[];
      }
    }),
  );

  return results.flat();
}
