// Praeventio Guard — Fase F.6 P1 #3 fix (PR #322 Codex review).
//
// IndexedDB-backed outbox for offline inspection starts + observations.
//
// PROBLEM (Codex P1 #3, line 173 OfflineInspection.tsx):
//   Before this fix the "Nueva inspección" handler called
//   `startInspection(projectId, ...)` directly. With no signal the
//   fetch silently failed, no local session was created, and the
//   inspector still SAW the modal close — but nothing persisted. Any
//   observations they later tried to add had no parent session.
//
// FIX:
//   Every inspection start AND every observation append goes through
//   this outbox FIRST. The outbox writes the entry to IndexedDB
//   (durable across reloads, tab crashes, kill-app-from-task-switcher)
//   and only THEN — if the device is currently online — tries the
//   network. Failures don't lose the entry; they just leave it in
//   `pending` state for the next flush.
//
//   The page reads the outbox to render a "Pendiente sincronizar"
//   badge on each local-only session/observation, and re-tries the
//   flush on every `online` event.
//
// STORAGE LAYOUT:
//   Database: `praeventio-inspections` (separate DB from the SLM queue
//     so the inspector quota doesn't fight the on-device model cache).
//   Stores:
//     - `pending_inspections` keyed by `id` (the client-generated
//       sessionId; same id the server sees so reconciliation is
//       trivial).
//     - `pending_observations` keyed by `observationId`.
//
// IDEMPOTENCY:
//   The server endpoints are idempotent by id / observationId (see
//   sprintK.ts), so retry-on-reconnect is always safe — duplicate
//   submissions never double-write the inspection.
//
// FALLBACK (NO INDEXEDDB):
//   In environments where `indexedDB` is not available (older jsdom in
//   unit tests, SSR-only render pass) the module falls back to an
//   in-memory Map. Tests can call `__resetInspectionOutboxForTests()`
//   to clear state between runs.
//
// Filosofía Praeventio:
//   - Detección Predictiva: el hallazgo de terreno NUNCA se pierde por
//     falta de señal — siempre cae primero en IndexedDB local.
//   - Respuesta Adaptativa: el flush corre por sí solo al volver la
//     red, sin pedir nada al inspector.
//   - Consolidación: la entrada se elimina del outbox una vez que el
//     server la confirma, dejando solo el record canónico remoto.

import { openDB, type IDBPDatabase } from 'idb';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type OutboxSyncStatus = 'pending' | 'synced' | 'failed';

export interface PendingInspection {
  /** Same id sent to the server. Stable across retries. */
  id: string;
  projectId: string;
  templateId: string;
  responsibleUid: string;
  /** ISO timestamp captured on the device the moment the session opened. */
  startedAt: string;
  /** UNIX epoch ms — used to age out stuck entries. */
  enqueuedAt: number;
  status: OutboxSyncStatus;
  /** Last error message from a failed flush (debug aid; never shown raw to inspector). */
  lastError?: string;
  /** Attempts so far. */
  attempts: number;
  /** Marker that the server confirmed receipt. */
  syncedAt?: number;
}

export interface PendingObservation {
  observationId: string;
  inspectionId: string;
  projectId: string;
  /** Optional checklist item this observation answers. */
  itemId?: string;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
  /** ISO recorded-at captured by the device at the moment of capture. */
  recordedAt: string;
  enqueuedAt: number;
  status: OutboxSyncStatus;
  lastError?: string;
  attempts: number;
  syncedAt?: number;
}

// ────────────────────────────────────────────────────────────────────────
// IndexedDB plumbing (with in-memory fallback for SSR / older jsdom)
// ────────────────────────────────────────────────────────────────────────

const DB_NAME = 'praeventio-inspections';
const DB_VERSION = 1;
const INSPECTIONS_STORE = 'pending_inspections';
const OBSERVATIONS_STORE = 'pending_observations';

let dbPromise: Promise<IDBPDatabase> | null = null;

const memInspections = new Map<string, PendingInspection>();
const memObservations = new Map<string, PendingObservation>();

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function getDb(): Promise<IDBPDatabase> | null {
  if (!hasIndexedDB()) return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(INSPECTIONS_STORE)) {
          db.createObjectStore(INSPECTIONS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(OBSERVATIONS_STORE)) {
          db.createObjectStore(OBSERVATIONS_STORE, { keyPath: 'observationId' });
        }
      },
    });
  }
  return dbPromise;
}

/** Test-only: clears all state (DB handle + in-memory fallback). */
export function __resetInspectionOutboxForTests(): void {
  dbPromise = null;
  memInspections.clear();
  memObservations.clear();
}

// ────────────────────────────────────────────────────────────────────────
// Inspection-level outbox API
// ────────────────────────────────────────────────────────────────────────

export async function enqueueInspectionStart(
  input: Omit<PendingInspection, 'enqueuedAt' | 'status' | 'attempts'>,
): Promise<PendingInspection> {
  const record: PendingInspection = {
    ...input,
    enqueuedAt: Date.now(),
    status: 'pending',
    attempts: 0,
  };
  const db = getDb();
  if (db) {
    await (await db).put(INSPECTIONS_STORE, record);
  } else {
    memInspections.set(record.id, record);
  }
  return record;
}

export async function listPendingInspections(): Promise<PendingInspection[]> {
  const db = getDb();
  if (db) {
    const all = (await (await db).getAll(INSPECTIONS_STORE)) as PendingInspection[];
    return all.filter((i) => i.status !== 'synced');
  }
  return Array.from(memInspections.values()).filter((i) => i.status !== 'synced');
}

export async function markInspectionSynced(id: string): Promise<void> {
  const db = getDb();
  if (db) {
    const existing = (await (await db).get(INSPECTIONS_STORE, id)) as
      | PendingInspection
      | undefined;
    if (!existing) return;
    await (await db).put(INSPECTIONS_STORE, {
      ...existing,
      status: 'synced',
      syncedAt: Date.now(),
    });
    return;
  }
  const existing = memInspections.get(id);
  if (existing) {
    memInspections.set(id, {
      ...existing,
      status: 'synced',
      syncedAt: Date.now(),
    });
  }
}

export async function markInspectionFailed(
  id: string,
  message: string,
): Promise<void> {
  const db = getDb();
  if (db) {
    const existing = (await (await db).get(INSPECTIONS_STORE, id)) as
      | PendingInspection
      | undefined;
    if (!existing) return;
    await (await db).put(INSPECTIONS_STORE, {
      ...existing,
      status: 'failed',
      lastError: message,
      attempts: existing.attempts + 1,
    });
    return;
  }
  const existing = memInspections.get(id);
  if (existing) {
    memInspections.set(id, {
      ...existing,
      status: 'failed',
      lastError: message,
      attempts: existing.attempts + 1,
    });
  }
}

export async function dropSyncedInspections(): Promise<number> {
  const db = getDb();
  if (db) {
    const all = (await (await db).getAll(INSPECTIONS_STORE)) as PendingInspection[];
    const synced = all.filter((i) => i.status === 'synced');
    const handle = await db;
    const tx = handle.transaction(INSPECTIONS_STORE, 'readwrite');
    await Promise.all(synced.map((i) => tx.store.delete(i.id)));
    await tx.done;
    return synced.length;
  }
  let count = 0;
  for (const [k, v] of memInspections.entries()) {
    if (v.status === 'synced') {
      memInspections.delete(k);
      count++;
    }
  }
  return count;
}

// ────────────────────────────────────────────────────────────────────────
// Observation-level outbox API
// ────────────────────────────────────────────────────────────────────────

export async function enqueueObservation(
  input: Omit<PendingObservation, 'enqueuedAt' | 'status' | 'attempts'>,
): Promise<PendingObservation> {
  const record: PendingObservation = {
    ...input,
    enqueuedAt: Date.now(),
    status: 'pending',
    attempts: 0,
  };
  const db = getDb();
  if (db) {
    await (await db).put(OBSERVATIONS_STORE, record);
  } else {
    memObservations.set(record.observationId, record);
  }
  return record;
}

export async function listPendingObservations(
  inspectionId?: string,
): Promise<PendingObservation[]> {
  const db = getDb();
  let all: PendingObservation[];
  if (db) {
    all = (await (await db).getAll(OBSERVATIONS_STORE)) as PendingObservation[];
  } else {
    all = Array.from(memObservations.values());
  }
  const pending = all.filter((o) => o.status !== 'synced');
  return inspectionId
    ? pending.filter((o) => o.inspectionId === inspectionId)
    : pending;
}

export async function countPendingObservations(
  inspectionId?: string,
): Promise<number> {
  return (await listPendingObservations(inspectionId)).length;
}

export async function markObservationSynced(
  observationId: string,
): Promise<void> {
  const db = getDb();
  if (db) {
    const existing = (await (await db).get(OBSERVATIONS_STORE, observationId)) as
      | PendingObservation
      | undefined;
    if (!existing) return;
    await (await db).put(OBSERVATIONS_STORE, {
      ...existing,
      status: 'synced',
      syncedAt: Date.now(),
    });
    return;
  }
  const existing = memObservations.get(observationId);
  if (existing) {
    memObservations.set(observationId, {
      ...existing,
      status: 'synced',
      syncedAt: Date.now(),
    });
  }
}

export async function markObservationFailed(
  observationId: string,
  message: string,
): Promise<void> {
  const db = getDb();
  if (db) {
    const existing = (await (await db).get(OBSERVATIONS_STORE, observationId)) as
      | PendingObservation
      | undefined;
    if (!existing) return;
    await (await db).put(OBSERVATIONS_STORE, {
      ...existing,
      status: 'failed',
      lastError: message,
      attempts: existing.attempts + 1,
    });
    return;
  }
  const existing = memObservations.get(observationId);
  if (existing) {
    memObservations.set(observationId, {
      ...existing,
      status: 'failed',
      lastError: message,
      attempts: existing.attempts + 1,
    });
  }
}

/**
 * Re-key a pending observation under a new observationId (used by the
 * caller when the server returns 409 `observation_id_conflict` and we
 * need to retry with a fresh UUID). The old row is removed.
 *
 * Codex PR #322 P2 #2: this is what unblocks the client-side retry
 * loop — without it, the queue would keep retrying the same conflicted
 * id forever.
 */
export async function rekeyObservation(
  oldObservationId: string,
  newObservationId: string,
): Promise<PendingObservation | null> {
  const db = getDb();
  if (db) {
    const existing = (await (await db).get(OBSERVATIONS_STORE, oldObservationId)) as
      | PendingObservation
      | undefined;
    if (!existing) return null;
    const handle = await db;
    const tx = handle.transaction(OBSERVATIONS_STORE, 'readwrite');
    const next: PendingObservation = {
      ...existing,
      observationId: newObservationId,
      status: 'pending',
      attempts: existing.attempts + 1,
      lastError: undefined,
    };
    await tx.store.delete(oldObservationId);
    await tx.store.put(next);
    await tx.done;
    return next;
  }
  const existing = memObservations.get(oldObservationId);
  if (!existing) return null;
  const next: PendingObservation = {
    ...existing,
    observationId: newObservationId,
    status: 'pending',
    attempts: existing.attempts + 1,
    lastError: undefined,
  };
  memObservations.delete(oldObservationId);
  memObservations.set(newObservationId, next);
  return next;
}

export async function dropSyncedObservations(): Promise<number> {
  const db = getDb();
  if (db) {
    const all = (await (await db).getAll(OBSERVATIONS_STORE)) as PendingObservation[];
    const synced = all.filter((o) => o.status === 'synced');
    const handle = await db;
    const tx = handle.transaction(OBSERVATIONS_STORE, 'readwrite');
    await Promise.all(synced.map((o) => tx.store.delete(o.observationId)));
    await tx.done;
    return synced.length;
  }
  let count = 0;
  for (const [k, v] of memObservations.entries()) {
    if (v.status === 'synced') {
      memObservations.delete(k);
      count++;
    }
  }
  return count;
}
