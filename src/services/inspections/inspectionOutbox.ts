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
//       trivial). Each row now carries an `ownerUid` so a multi-user
//       device (kiosk/shared tablet) never flushes user A's queue
//       under user B's auth token.
//     - `pending_observations` keyed by `observationId`, also tagged
//       with `ownerUid` for the same isolation reason.
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
// CONCURRENCY (Codex round 2 hardening):
//   - `acquireFlushLock()` is module-scoped, so a StrictMode double
//     mount / second tab / HMR remount can't fire two flushes in
//     parallel and double-POST the same observation. The lock auto-
//     releases on caller `release()` (try/finally pattern).
//   - `clearForUser(uid)` exists so the auth layer can purge another
//     user's queue when a new user signs in on the same device, before
//     the new user's bearer token starts flushing the stale rows.
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
  /**
   * Codex round 2: the Firebase uid that owned the session at enqueue
   * time. Used to filter the flush queue when a different user is
   * signed in on the same device (kiosks, shared tablets), so user A's
   * stuck queue never POSTs under user B's bearer token. Optional for
   * backward compatibility with rows enqueued before this field
   * existed; legacy rows are treated as "any owner".
   */
  ownerUid?: string;
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
  /** Same role as PendingInspection.ownerUid — see comment above. */
  ownerUid?: string;
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

/** Test-only: clears all state (DB handle + in-memory fallback + locks). */
export function __resetInspectionOutboxForTests(): void {
  dbPromise = null;
  memInspections.clear();
  memObservations.clear();
  flushLockHeld = false;
}

// ────────────────────────────────────────────────────────────────────────
// Module-level flush lock (Codex round 2 hardening).
//
// `<OfflineInspection>` may mount twice under React StrictMode (which
// runs the effect → cleanup → effect cycle in development), and HMR /
// route remounts can also momentarily render two copies. A per-
// component `useRef` lock doesn't prevent a SECOND tab on the same
// device from kicking off a concurrent flush either. Both scenarios
// would pick the same `pending` observation row and POST it in
// parallel — even though the server is idempotent by id, the second
// POST is wasted work and would race the `markObservationSynced`
// write.
//
// The lock is intentionally tiny: a boolean + an `acquire/release`
// pair. We do NOT use a true mutex because there's nothing to await —
// the second caller should just bail and let the first flush drain
// the queue.
// ────────────────────────────────────────────────────────────────────────

let flushLockHeld = false;

/**
 * Attempt to take the flush lock. Returns `true` if acquired; the
 * caller MUST invoke `releaseFlushLock()` when done (try / finally).
 * Returns `false` if another flush is already in progress; the caller
 * should bail gracefully — the in-flight flush will drain the queue.
 */
export function acquireFlushLock(): boolean {
  if (flushLockHeld) return false;
  flushLockHeld = true;
  return true;
}

export function releaseFlushLock(): void {
  flushLockHeld = false;
}

/**
 * Codex round 2: purge ALL pending rows whose `ownerUid` does not match
 * `currentUid`. Call this from the auth boundary on every sign-in or
 * tenant switch so a previous user's stuck queue is not posted under
 * the new user's bearer token. Legacy rows with no `ownerUid` are
 * KEPT (we can't prove they belong to someone else) — once they reach
 * the server the per-uid security rules there reject any cross-tenant
 * leakage anyway. Returns the count of rows removed.
 */
export async function clearOutboxForOtherUsers(
  currentUid: string,
): Promise<number> {
  const db = getDb();
  let removed = 0;
  if (db) {
    const handle = await db;
    const insps = (await handle.getAll(INSPECTIONS_STORE)) as PendingInspection[];
    const obs = (await handle.getAll(OBSERVATIONS_STORE)) as PendingObservation[];
    const stale = insps.filter(
      (i) => typeof i.ownerUid === 'string' && i.ownerUid !== currentUid,
    );
    const staleObs = obs.filter(
      (o) => typeof o.ownerUid === 'string' && o.ownerUid !== currentUid,
    );
    if (stale.length) {
      const tx = handle.transaction(INSPECTIONS_STORE, 'readwrite');
      await Promise.all(stale.map((i) => tx.store.delete(i.id)));
      await tx.done;
    }
    if (staleObs.length) {
      const tx = handle.transaction(OBSERVATIONS_STORE, 'readwrite');
      await Promise.all(staleObs.map((o) => tx.store.delete(o.observationId)));
      await tx.done;
    }
    removed = stale.length + staleObs.length;
    return removed;
  }
  for (const [k, v] of memInspections.entries()) {
    if (typeof v.ownerUid === 'string' && v.ownerUid !== currentUid) {
      memInspections.delete(k);
      removed++;
    }
  }
  for (const [k, v] of memObservations.entries()) {
    if (typeof v.ownerUid === 'string' && v.ownerUid !== currentUid) {
      memObservations.delete(k);
      removed++;
    }
  }
  return removed;
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

/**
 * List pending (non-synced) inspections. When `ownerUid` is provided
 * only rows belonging to that uid (or legacy rows with no ownerUid,
 * see clearOutboxForOtherUsers note) are returned. The flush loop
 * passes the current `auth.currentUser.uid` so a multi-user device
 * never POSTs another user's queue under the new caller's token.
 */
export async function listPendingInspections(
  ownerUid?: string,
): Promise<PendingInspection[]> {
  const db = getDb();
  const matchOwner = (i: PendingInspection): boolean => {
    if (!ownerUid) return true;
    if (typeof i.ownerUid !== 'string') return true; // legacy row
    return i.ownerUid === ownerUid;
  };
  if (db) {
    const all = (await (await db).getAll(INSPECTIONS_STORE)) as PendingInspection[];
    return all.filter((i) => i.status !== 'synced' && matchOwner(i));
  }
  return Array.from(memInspections.values()).filter(
    (i) => i.status !== 'synced' && matchOwner(i),
  );
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

/**
 * List pending (non-synced) observations. Filters:
 *   - `inspectionId` — scope to a single parent session (used by the
 *     detail modal to gate "Cerrar inspección").
 *   - `ownerUid` — Codex round 2: scope to the currently signed-in user
 *     so a queue inherited from a previous session on a shared device
 *     is not POSTed under the new caller's token. Legacy rows without
 *     ownerUid are included (see clearOutboxForOtherUsers note).
 */
export async function listPendingObservations(
  inspectionId?: string,
  ownerUid?: string,
): Promise<PendingObservation[]> {
  const db = getDb();
  let all: PendingObservation[];
  if (db) {
    all = (await (await db).getAll(OBSERVATIONS_STORE)) as PendingObservation[];
  } else {
    all = Array.from(memObservations.values());
  }
  const matchOwner = (o: PendingObservation): boolean => {
    if (!ownerUid) return true;
    if (typeof o.ownerUid !== 'string') return true; // legacy row
    return o.ownerUid === ownerUid;
  };
  const pending = all.filter((o) => o.status !== 'synced' && matchOwner(o));
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
