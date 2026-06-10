// Praeventio Guard — TODO.md §12.2.2: conflict_queue para safety docs.
//
// Helper que escribe conflictos críticos (`Conflict` con al menos un
// field `critical: true`) a Firestore `conflict_queue/{queueId}` para
// resolución asíncrona por supervisor. Reemplaza/complementa el
// window event `sync-critical-conflict` que solo notificaba al
// usuario activo: el queue persiste el conflicto aunque el usuario
// cierre la app, y un admin puede resolverlo desde una página
// dedicada.
//
// Pure compute + Firestore write. NO incluye UI ni hook React (eso
// queda en consumer-side).

import type { Conflict } from './conflictResolver.js';
import { requiresHumanResolution } from './conflictResolver.js';

export type ConflictQueueStatus =
  | 'pending'           // recién escrito, supervisor no ha tocado
  | 'in_review'         // supervisor abrió el item
  | 'resolved'          // supervisor escogió valor canónico
  | 'rejected'          // supervisor declaró el conflicto como invalid
  | 'expired';          // pasó la ventana de resolución (auditoría)

export interface ConflictQueueEntry {
  /** ID único del registro (sha256 del docType+docId+timestamp). */
  queueId: string;
  /** Conflicto original. */
  conflict: Conflict;
  /** UID que escribió el local action (no necesariamente quien resolverá). */
  localAuthorUid: string;
  /** Project asociado (para RBAC). */
  projectId: string;
  /** Status actual. */
  status: ConflictQueueStatus;
  /** ISO timestamp cuándo se escribió. */
  enqueuedAt: string;
  /** ISO cuándo se resolvió (si aplica). */
  resolvedAt?: string;
  /** UID del supervisor que resolvió. */
  resolvedByUid?: string;
  /** Resolución por campo (echo back para audit). */
  resolution?: Record<string, { chosen: 'local' | 'remote' | 'manual'; value: unknown }>;
  /** Notas de la resolución. */
  notes?: string;
}

export class ConflictQueueValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'ConflictQueueValidationError';
  }
}

const QUEUE_ID_LENGTH = 32;

function deterministicQueueId(
  conflict: Conflict,
  localAuthorUid: string,
  enqueuedAt: string,
): string {
  // Determinístico para idempotencia: si el mismo conflicto se intenta
  // enqueue dos veces (por reintento de red), produce el mismo queueId.
  const payload = `${conflict.collection}|${conflict.docId}|${conflict.docType}|${conflict.localUpdatedAt}|${conflict.serverUpdatedAt}|${localAuthorUid}|${enqueuedAt}`;
  // SHA-256 via @noble/hashes (no Buffer/Node-only dep).
  // Importamos lazy para que el módulo siga siendo cross-env (jsdom + node).

  const { sha256 } = require('@noble/hashes/sha2.js');
  const { utf8ToBytes, bytesToHex } = require('@noble/hashes/utils.js');
  return bytesToHex(sha256(utf8ToBytes(payload))).slice(0, QUEUE_ID_LENGTH);
}

/**
 * Decide si un Conflict debe escribirse al conflict_queue. Reglas:
 *
 *  1. El doc type está en ALWAYS_REQUIRES_HUMAN_RESOLUTION → siempre sí.
 *  2. Cualquier field tiene `critical: true` → sí.
 *  3. Si es deletion conflict → sí (borrar evidencia es siempre crítico).
 *  4. Si solo hay LWW non-critical → no (resolver puede LWW-merge directo).
 */
export function shouldEnqueueForHumanResolution(conflict: Conflict): boolean {
  if (requiresHumanResolution(conflict.docType)) return true;
  if (conflict.isDeletionConflict) return true;
  return conflict.fields.some((f) => f.critical);
}

export interface EnqueueInput {
  conflict: Conflict;
  localAuthorUid: string;
  projectId: string;
  /** Override now para tests. */
  now?: Date;
}

/**
 * Construye la entry sin escribir a Firestore. El caller decide
 * cómo persistirla (Firestore Admin, client SDK, ETL job, etc.).
 */
export function buildConflictQueueEntry(input: EnqueueInput): ConflictQueueEntry {
  if (!input.localAuthorUid || input.localAuthorUid.length === 0) {
    throw new ConflictQueueValidationError(
      'MISSING_UID',
      'localAuthorUid required',
    );
  }
  if (!input.projectId || input.projectId.length === 0) {
    throw new ConflictQueueValidationError(
      'MISSING_PROJECT',
      'projectId required',
    );
  }
  const enqueuedAt = (input.now ?? new Date()).toISOString();
  const queueId = deterministicQueueId(
    input.conflict,
    input.localAuthorUid,
    enqueuedAt,
  );
  return {
    queueId,
    conflict: input.conflict,
    localAuthorUid: input.localAuthorUid,
    projectId: input.projectId,
    status: 'pending',
    enqueuedAt,
  };
}

/**
 * Filtra una lista de conflictos y devuelve solo las entries que deben
 * persistirse al conflict_queue. Los conflictos no-críticos quedan
 * fuera (el caller los puede resolver con LWW directo).
 */
export function selectEntriesToEnqueue(
  conflicts: Conflict[],
  localAuthorUid: string,
  projectId: string,
  now: Date = new Date(),
): ConflictQueueEntry[] {
  const out: ConflictQueueEntry[] = [];
  for (const c of conflicts) {
    if (!shouldEnqueueForHumanResolution(c)) continue;
    out.push(
      buildConflictQueueEntry({
        conflict: c,
        localAuthorUid,
        projectId,
        now,
      }),
    );
  }
  return out;
}

/**
 * Transición a 'resolved' con la elección del supervisor por field.
 * Pure — el caller persiste el resultado.
 */
export function resolveConflictQueueEntry(
  entry: ConflictQueueEntry,
  resolverUid: string,
  resolution: Record<string, { chosen: 'local' | 'remote' | 'manual'; value: unknown }>,
  notes?: string,
  now: Date = new Date(),
): ConflictQueueEntry {
  if (entry.status === 'resolved' || entry.status === 'rejected') {
    throw new ConflictQueueValidationError(
      'ALREADY_FINALIZED',
      `conflict ${entry.queueId} already in status ${entry.status}`,
    );
  }
  // Verificar que cubre todos los critical fields del conflicto.
  const criticalFieldNames = entry.conflict.fields
    .filter((f) => f.critical)
    .map((f) => f.field);
  const missing = criticalFieldNames.filter((f) => !(f in resolution));
  if (missing.length > 0) {
    throw new ConflictQueueValidationError(
      'INCOMPLETE_RESOLUTION',
      `resolution missing critical fields: ${missing.join(', ')}`,
    );
  }
  return {
    ...entry,
    status: 'resolved',
    resolvedAt: now.toISOString(),
    resolvedByUid: resolverUid,
    resolution,
    notes,
  };
}

export function markInReview(
  entry: ConflictQueueEntry,
  reviewerUid: string,
  _now: Date = new Date(),
): ConflictQueueEntry {
  if (entry.status !== 'pending') {
    throw new ConflictQueueValidationError(
      'NOT_PENDING',
      `cannot mark in_review from status ${entry.status}`,
    );
  }
  // El reviewerUid se persiste en logs (no en el record para no
  // pre-asignar la resolución a este usuario).
  void reviewerUid;
  return {
    ...entry,
    status: 'in_review',
    // No tocamos resolvedByUid hasta que se complete la resolución.
    enqueuedAt: entry.enqueuedAt,
  };
}

export function rejectAsInvalid(
  entry: ConflictQueueEntry,
  reviewerUid: string,
  reason: string,
  now: Date = new Date(),
): ConflictQueueEntry {
  if (entry.status === 'resolved' || entry.status === 'rejected') {
    throw new ConflictQueueValidationError(
      'ALREADY_FINALIZED',
      `conflict ${entry.queueId} already in status ${entry.status}`,
    );
  }
  if (!reason || reason.trim().length < 5) {
    throw new ConflictQueueValidationError(
      'REASON_TOO_SHORT',
      'rejection reason must be ≥5 chars (audit trail)',
    );
  }
  return {
    ...entry,
    status: 'rejected',
    resolvedAt: now.toISOString(),
    resolvedByUid: reviewerUid,
    notes: reason,
  };
}
