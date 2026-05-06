// Sprint 34 — Per-field conflict resolver for offline sync.
//
// Design rule (product): the app RECOMMENDS but never auto-decides on
// semantically critical fields. Two-writer divergence on safety-critical
// fields (severity, priority, status, controls, …) ALWAYS prompts the
// human supervisor. Non-critical text fields fall back to per-field
// last-writer-wins (LWW) using `updatedAt` timestamps.
//
// Pure module — no React, no Firestore. The OfflineSyncManager wires
// `detectConflicts()` against the Firestore `getDoc` snapshot and
// surfaces critical conflicts via the `sync-critical-conflict` window
// event, which the ConflictResolutionDrawer consumes.

export type DocType =
  | 'RiskNode'
  | 'Incident'
  | 'ErgonomicAssessment'
  | string;

/**
 * Per-doc-type list of fields that REQUIRE human resolution on
 * divergence. Extensible — callers can pass an override map to
 * `detectConflicts` if a vertical needs different semantics.
 */
export const CRITICAL_FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  RiskNode: ['severity', 'priority', 'status', 'assignedTo', 'controls', 'iperScore'],
  Incident: ['severity', 'rootCause', 'status', 'closedAt', 'mitigation'],
  ErgonomicAssessment: ['rebaScore', 'rulaScore', 'recommendation', 'workerUid'],
};

/**
 * Subset of a `SyncAction` payload relevant to conflict detection. Kept
 * structural so we can feed both the legacy queue and the state-machine
 * SyncOperation through the same pipeline.
 */
export interface PendingAction {
  /** Document id this action targets (omitted for `create` ops). */
  docId?: string;
  /** Firestore collection name — used to map to docType. */
  collection: string;
  type: 'create' | 'update' | 'delete' | 'upload' | 'set';
  /**
   * The fields the offline writer changed. Other fields on the doc are
   * untouched by this action and therefore cannot conflict.
   */
  data: Record<string, unknown>;
  /** ISO timestamp captured when the action was queued offline. */
  localUpdatedAt: string;
  /** Optional doc-type hint when the collection name is ambiguous. */
  docType?: DocType;
}

/** Snapshot of the server doc as read just before applying the pending op. */
export interface DocSnapshot {
  collection: string;
  docId: string;
  /** Full server-side document data (post any peer writes). */
  data: Record<string, unknown>;
  /** ISO timestamp of the latest server write. */
  serverUpdatedAt: string;
  docType?: DocType;
}

export interface FieldConflict {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  /** Whether this field must be resolved by a human. */
  critical: boolean;
}

export interface Conflict {
  collection: string;
  docId: string;
  docType: DocType;
  localUpdatedAt: string;
  serverUpdatedAt: string;
  /** True when the local action was a delete that races a server update. */
  isDeletionConflict: boolean;
  fields: FieldConflict[];
}

export type ResolutionChoice = 'local' | 'remote' | 'manual';

export interface ResolvedField {
  field: string;
  chosen: ResolutionChoice;
  value: unknown;
  /** Echoes back the source values for audit. */
  localValue: unknown;
  remoteValue: unknown;
}

export interface AuditRow {
  docId: string;
  collection: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  chosen: ResolutionChoice;
  byUid: string | null;
  /** ISO timestamp when the resolution was applied. */
  appliedAt: string;
  /** Whether the resolver picked LWW automatically. */
  automatic: boolean;
}

/** Map a Firestore collection name to a DocType for CRITICAL_FIELDS lookup. */
function inferDocType(action: { collection: string; docType?: DocType }): DocType {
  if (action.docType) return action.docType;
  // Convention used across the repo: `nodes` are RiskNode, `incidents`
  // are Incident, `ergonomic_assessments` are ErgonomicAssessment.
  switch (action.collection) {
    case 'nodes':
      return 'RiskNode';
    case 'incidents':
      return 'Incident';
    case 'ergonomic_assessments':
    case 'ergonomicAssessments':
      return 'ErgonomicAssessment';
    default:
      return action.collection;
  }
}

function isCriticalField(
  docType: DocType,
  field: string,
  overrides?: Record<string, readonly string[]>,
): boolean {
  const map = overrides ?? CRITICAL_FIELDS_BY_TYPE;
  const list = map[docType];
  if (!list) return false;
  return list.includes(field);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  // Cheap structural compare — sufficient for primitives and small
  // arrays/objects we see in safety payloads. We deliberately avoid
  // pulling lodash for one comparator.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Compare a queued local action against the current server snapshot and
 * produce a per-field conflict report. Fields the local writer didn't
 * touch are never reported. Fields that match the server are dropped.
 */
export function detectConflicts(
  localPending: PendingAction[],
  remoteSnapshot: DocSnapshot[],
  options?: { overrides?: Record<string, readonly string[]> },
): Conflict[] {
  const out: Conflict[] = [];
  const remoteByKey = new Map<string, DocSnapshot>();
  for (const s of remoteSnapshot) {
    remoteByKey.set(`${s.collection}:${s.docId}`, s);
  }

  for (const action of localPending) {
    if (!action.docId) continue; // creates can't conflict on a docId.
    const key = `${action.collection}:${action.docId}`;
    const remote = remoteByKey.get(key);
    if (!remote) continue; // server has no version — no conflict.

    // Only treat as a conflict if the server moved AFTER the local
    // queue timestamp. Same-or-older server == we just wrote behind a
    // peer who hasn't synced — no divergence.
    if (
      action.localUpdatedAt &&
      remote.serverUpdatedAt &&
      new Date(remote.serverUpdatedAt).getTime() <=
        new Date(action.localUpdatedAt).getTime()
    ) {
      continue;
    }

    const docType = inferDocType({
      collection: action.collection,
      docType: action.docType ?? remote.docType,
    });

    if (action.type === 'delete') {
      out.push({
        collection: action.collection,
        docId: action.docId,
        docType,
        localUpdatedAt: action.localUpdatedAt,
        serverUpdatedAt: remote.serverUpdatedAt,
        isDeletionConflict: true,
        // Synthetic critical entry — deletion vs update is always
        // critical; one writer wants the doc gone, the other has new
        // data on it. The drawer renders this as a special case.
        fields: [
          {
            field: '__deletion__',
            localValue: null,
            remoteValue: remote.data,
            critical: true,
          },
        ],
      });
      continue;
    }

    const fieldConflicts: FieldConflict[] = [];
    for (const [field, localValue] of Object.entries(action.data)) {
      // Skip metadata / housekeeping fields.
      if (
        field === 'id' ||
        field === 'updatedAt' ||
        field === 'originalUpdatedAt' ||
        field === 'createdAt'
      )
        continue;
      const remoteValue = remote.data[field];
      // Local-only add (server lacks the field) — no conflict, just
      // additive merge. Test 4 covers this.
      if (remoteValue === undefined) continue;
      if (valuesEqual(localValue, remoteValue)) continue;
      fieldConflicts.push({
        field,
        localValue,
        remoteValue,
        critical: isCriticalField(docType, field, options?.overrides),
      });
    }

    if (fieldConflicts.length === 0) continue;

    out.push({
      collection: action.collection,
      docId: action.docId,
      docType,
      localUpdatedAt: action.localUpdatedAt,
      serverUpdatedAt: remote.serverUpdatedAt,
      isDeletionConflict: false,
      fields: fieldConflicts,
    });
  }

  return out;
}

/**
 * Last-writer-wins resolution for a SINGLE non-critical field. The
 * later `updatedAt` wins; if timestamps tie or are missing, the local
 * value wins (worker pulled the trigger more recently from their POV).
 *
 * Throws if called on a critical field — callers must route those to
 * the manual drawer instead.
 */
export function resolveLww(
  conflict: Conflict,
  fieldConflict: FieldConflict,
): ResolvedField {
  if (fieldConflict.critical) {
    throw new Error(
      `resolveLww called on critical field "${fieldConflict.field}" — must use manual resolution`,
    );
  }
  const localMs = Date.parse(conflict.localUpdatedAt);
  const remoteMs = Date.parse(conflict.serverUpdatedAt);
  const localWins =
    !Number.isFinite(remoteMs) ||
    (Number.isFinite(localMs) && localMs >= remoteMs);
  return {
    field: fieldConflict.field,
    chosen: localWins ? 'local' : 'remote',
    value: localWins ? fieldConflict.localValue : fieldConflict.remoteValue,
    localValue: fieldConflict.localValue,
    remoteValue: fieldConflict.remoteValue,
  };
}

/** True when ANY field in the conflict requires human resolution. */
export function requiresManualResolution(conflict: Conflict): boolean {
  return conflict.fields.some((f) => f.critical);
}

/**
 * Partition a conflict's fields into auto-resolvable (LWW) vs
 * manual-required. The OfflineSyncManager applies the LWW set
 * immediately and emits a `sync-critical-conflict` event for the
 * manual subset.
 */
export function partitionFields(conflict: Conflict): {
  autoResolvable: FieldConflict[];
  manual: FieldConflict[];
} {
  const autoResolvable: FieldConflict[] = [];
  const manual: FieldConflict[] = [];
  for (const f of conflict.fields) {
    if (f.critical) manual.push(f);
    else autoResolvable.push(f);
  }
  return { autoResolvable, manual };
}

/** Build an audit row from a resolved field. */
export function buildAuditRow(
  conflict: Conflict,
  resolved: ResolvedField,
  byUid: string | null,
  automatic: boolean,
): AuditRow {
  return {
    docId: conflict.docId,
    collection: conflict.collection,
    field: resolved.field,
    localValue: resolved.localValue,
    remoteValue: resolved.remoteValue,
    chosen: resolved.chosen,
    byUid,
    appliedAt: new Date().toISOString(),
    automatic,
  };
}
