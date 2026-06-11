// SystemEngine — EventLog.
//
// `emit()` is the single write path. Order:
//   1. Validate via Zod (fail-closed: invalid events are rejected before any
//      side effect).
//   2. Idempotency check against the last-1h ring buffer in IDB.
//   3. If the envelope has NO `projectId` → local-only: in-process
//      subscribers were already notified, the Firestore hop is explicitly
//      skipped (no write, no queue, no error).
//   4. If online → write to `projects/{projectId}/system_events/{eventId}`
//      and mirror to `audit_logs` for the immutable persistent trail.
//   5. If offline → enqueue in IDB. The sync worker drains on `online`.
//   6. Notify in-process subscribers immediately (low-latency UI; the
//      Firestore round-trip arrives later when online).
//
// A4 re-scope (2026-06): the bus used to write `tenants/{tenantId}/…`,
// which was doubly dead in production — `window.__GP_TENANT_ID__` was never
// assigned (every install fell to 'default') AND firestore.rules has no
// `system_events` block under the tenants catch-all (`create:false`), so
// every cross-device write was PERMISSION_DENIED. The PROJECT is the real
// tenancy unit the whole app uses (`projects/{pid}` + `isProjectMember()`),
// so the path key is now the envelope's `projectId`. `tenantId` stays in
// the event payload as informational metadata only.
//
// The IDB store is a thin wrapper, deliberately separate from
// `slm/offlineQueue.ts` (which has its own HMAC + reconciliation contract).

import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { openDB, type IDBPDatabase } from 'idb';

import { db, auth } from '../firebase';
import { logger } from '../../utils/logger';
import { randomId } from '../../utils/randomId';
import { SystemEventSchema, type SystemEvent } from './eventTypes';

const DB_NAME = 'praeventio-systemengine';
const DB_VERSION = 1;
const OUTBOX_STORE = 'system_events_outbox';
const IDEMPOTENCY_STORE = 'idempotency_ring_1h';
const IDEMPOTENCY_WINDOW_MS = 60 * 60 * 1000;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getIdb(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(idb) {
        if (!idb.objectStoreNames.contains(OUTBOX_STORE)) {
          idb.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        }
        if (!idb.objectStoreNames.contains(IDEMPOTENCY_STORE)) {
          idb.createObjectStore(IDEMPOTENCY_STORE, { keyPath: 'idempotencyKey' });
        }
      },
    });
  }
  return dbPromise;
}

export interface EmitResult {
  ok: boolean;
  queued?: boolean;
  duplicate?: boolean;
  error?: string;
  eventId?: string;
}

export interface EmitOptions {
  /** Skip the audit_logs mirror. Used by audit_log_appended itself to avoid loops. */
  skipAuditMirror?: boolean;
}

type LocalListener = (event: SystemEvent) => void;
const localListeners = new Set<LocalListener>();

export function onLocalEmit(listener: LocalListener): () => void {
  localListeners.add(listener);
  return () => {
    localListeners.delete(listener);
  };
}

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

async function alreadySeen(idempotencyKey: string): Promise<boolean> {
  try {
    const idb = await getIdb();
    const tx = idb.transaction(IDEMPOTENCY_STORE, 'readwrite');
    const store = tx.objectStore(IDEMPOTENCY_STORE);
    const existing = await store.get(idempotencyKey);
    const now = Date.now();
    if (existing && now - (existing.ts as number) < IDEMPOTENCY_WINDOW_MS) {
      await tx.done;
      return true;
    }
    await store.put({ idempotencyKey, ts: now });
    await tx.done;
    return false;
  } catch (err) {
    logger.warn('systemEngine.eventLog: idempotency check failed', { err: String(err) });
    return false;
  }
}

async function enqueueOffline(event: SystemEvent): Promise<void> {
  const idb = await getIdb();
  const tx = idb.transaction(OUTBOX_STORE, 'readwrite');
  await tx.objectStore(OUTBOX_STORE).put({ ...event, _enqueuedAt: Date.now() });
  await tx.done;
}

export async function emit(
  event: SystemEvent,
  opts: EmitOptions = {},
): Promise<EmitResult> {
  const parsed = SystemEventSchema.safeParse(event);
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    logger.warn('systemEngine.eventLog: invalid event rejected', { error });
    return { ok: false, error };
  }

  const validated = parsed.data;

  if (await alreadySeen(validated.idempotencyKey)) {
    return { ok: true, duplicate: true, eventId: validated.id };
  }

  // In-process subscribers fire synchronously regardless of online state —
  // the UI should not wait for a Firestore round-trip to react.
  for (const listener of localListeners) {
    try {
      listener(validated);
    } catch (err) {
      logger.warn('systemEngine.eventLog: local listener threw', { err: String(err) });
    }
  }

  // No selected project → the engine stays LOCAL-ONLY by design (the bus
  // path is project-scoped). Skip the Firestore hop and the offline queue
  // explicitly: a project-less event can never be delivered cross-device,
  // so queuing it would only accumulate undeliverable records.
  if (!validated.projectId) {
    return { ok: true, eventId: validated.id };
  }

  if (!isOnline()) {
    try {
      await enqueueOffline(validated);
      return { ok: true, queued: true, eventId: validated.id };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  try {
    const path = `projects/${validated.projectId}/system_events`;
    await setDoc(doc(db, path, validated.id), {
      ...validated,
      serverTs: serverTimestamp(),
    });

    if (!opts.skipAuditMirror) {
      // Best-effort mirror to audit_logs for the immutable trail. Server
      // rules forbid client writes to audit_logs, so this hop goes through
      // the existing /api/audit-log endpoint when a uid is present.
      void mirrorToAuditLogs(validated).catch((err) =>
        logger.warn('systemEngine.eventLog: audit mirror failed (non-fatal)', { err: String(err) }),
      );
    }

    return { ok: true, eventId: validated.id };
  } catch (err) {
    // Network blip between the navigator.onLine check and the actual write —
    // fall back to the offline queue so we don't lose the event.
    logger.warn('systemEngine.eventLog: write failed, queuing offline', { err: String(err) });
    try {
      await enqueueOffline(validated);
      return { ok: true, queued: true, eventId: validated.id };
    } catch (queueErr) {
      return { ok: false, error: String(queueErr) };
    }
  }
}

async function mirrorToAuditLogs(event: SystemEvent): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const { apiAuthHeader } = await import('../../lib/apiAuth');
  const authHeader = await apiAuthHeader();
  if (!authHeader) return;
  await fetch('/api/audit-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    credentials: 'include',
    body: JSON.stringify({
      action: `systemEngine.${event.type}`,
      resourceId: event.id,
      tenantId: event.tenantId,
      metadata: { eventType: event.type, projectId: event.projectId ?? null },
    }),
  });
}

/**
 * Build a minimal envelope. Callers fill in `payload` and `type`; this helper
 * stamps id, ts, and idempotencyKey defaults so emitters don't have to.
 */
export function buildEnvelope(input: {
  tenantId: string;
  projectId?: string;
  actorUid?: string | null;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}): {
  id: string;
  tenantId: string;
  projectId?: string;
  actorUid?: string | null;
  ts: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
} {
  const id = randomId();
  return {
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    actorUid: input.actorUid ?? null,
    ts: Date.now(),
    idempotencyKey: input.idempotencyKey ?? id,
    metadata: input.metadata,
  };
}

/**
 * Drains the offline outbox to Firestore. Caller decides when (typically on
 * `online` event). Returns counts { drained, failed }.
 */
export async function drainOutbox(): Promise<{ drained: number; failed: number }> {
  if (!isOnline()) return { drained: 0, failed: 0 };
  let drained = 0;
  let failed = 0;
  try {
    const idb = await getIdb();
    const tx = idb.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const all = await store.getAll();
    for (const record of all) {
      try {
        const { _enqueuedAt: _, ...event } = record as SystemEvent & { _enqueuedAt: number };
        if (!event.projectId) {
          // Legacy record from the pre-rescope (tenant-pathed) code, or a
          // project-less event: undeliverable on the project bus. Drop it
          // so the outbox doesn't accumulate poison records forever.
          logger.warn('systemEngine.eventLog: dropping undeliverable outbox record without projectId', {
            eventId: event.id,
          });
          await store.delete(event.id);
          continue;
        }
        const path = `projects/${event.projectId}/system_events`;
        await setDoc(doc(db, path, event.id), { ...event, serverTs: serverTimestamp() });
        await store.delete(event.id);
        drained++;
      } catch (err) {
        logger.warn('systemEngine.eventLog: outbox flush failed for record', {
          err: String(err),
          eventId: (record as { id?: string })?.id,
        });
        failed++;
      }
    }
    await tx.done;
  } catch (err) {
    logger.warn('systemEngine.eventLog: drainOutbox top-level failure', { err: String(err) });
  }
  return { drained, failed };
}

/** Test-only: wipes both stores. */
export async function __resetForTests(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const idb = await getIdb();
    await idb.clear(OUTBOX_STORE);
    await idb.clear(IDEMPOTENCY_STORE);
  } catch {
    // ignore — fresh DB
  }
  localListeners.clear();
}
