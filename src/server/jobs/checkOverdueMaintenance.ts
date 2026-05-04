// SPDX-License-Identifier: MIT
//
// Bucket K.3 — Overdue maintenance reaper.
//
// Cron-invoked job that scans `calendar_events` for entries whose
// `startIso` has passed while `status` is still `pending`, then flips
// the corresponding PlacedObject's `lifecycle` from `installed` /
// `active` → `maintenance_due`. The calendar event itself moves from
// `pending` → `overdue` so the next pass doesn't double-count.
//
// Designed to run from Cloud Scheduler via POST /api/maintenance/check-overdue
// at ~1 h cadence — see `routes/maintenance.ts` for the wrapper.
//
// Why a job (not a Firestore trigger):
//   • Triggers fire on writes; vencimientos don't write — they pass.
//   • A scheduled scan tolerates clock skew + missed events without
//     bookkeeping; it's strictly idempotent (we only flip pending →
//     overdue, never the other way around).
//   • Easier to reason about under flaky network: re-run = no harm.
//
// Reuse note: the lifecycle vocabulary lives in
// `services/digitalTwin/photogrammetry/types.ts`. We don't import it
// here to keep this server module decoupled from the Three.js-flavoured
// photogrammetry types — the lifecycle states we care about are just
// strings. The unit tests pin them down.

import type { Firestore } from 'firebase-admin/firestore';

/**
 * Lifecycles for which an overdue calendar event should bump the
 * placed object into `maintenance_due`. Anything outside this set
 * (e.g. `retired`, `planning`) is intentionally skipped — un objeto
 * retirado no genera deuda de mantenimiento.
 */
export const ACTIVE_LIFECYCLES: ReadonlySet<string> = new Set([
  'installed',
  'active',
]);

/** Lazy accessor — keeps `firebase-admin` out of import cycles. */
type FirestoreFactory = () => Firestore;

export interface CheckOverdueOptions {
  /**
   * Firestore handle factory. Default reads from firebase-admin (lazy
   * import so tests that mock the SDK don't pay the import cost).
   */
  getDb?: FirestoreFactory;
  /** Override of "now" for tests / replays. Default `new Date()`. */
  now?: () => Date;
  /** Page size for the calendar_events scan. Default 100. */
  limit?: number;
}

export interface CheckOverdueResult {
  /** Number of PlacedObjects flipped to `maintenance_due`. */
  updated: number;
  /** Number of calendar_events flipped from `pending` → `overdue`. */
  eventsFlipped: number;
  /** Number of events skipped (object missing, retired, planning, etc.). */
  skipped: number;
}

/**
 * Scan + reap. Returns counts so the HTTP wrapper can surface progress
 * to the operator dashboard.
 */
export async function checkOverdueMaintenance(
  opts: CheckOverdueOptions = {},
): Promise<CheckOverdueResult> {
  const db = opts.getDb
    ? opts.getDb()
    : (await import('firebase-admin')).default.firestore();
  const now = (opts.now ?? (() => new Date()))();
  const pageSize = opts.limit ?? 100;

  const snap = await db
    .collection('calendar_events')
    .where('startIso', '<=', now.toISOString())
    .where('status', '==', 'pending')
    .limit(pageSize)
    .get();

  let updated = 0;
  let eventsFlipped = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const event = doc.data() as {
      projectId?: string;
      relatedObjectId?: string;
      status?: string;
    };

    if (!event.projectId || !event.relatedObjectId) {
      // Bad data — flip to overdue anyway so we stop iterating it.
      await doc.ref.update({ status: 'overdue', overdueAt: now.toISOString() });
      eventsFlipped += 1;
      skipped += 1;
      continue;
    }

    const objRef = db
      .collection('projects')
      .doc(event.projectId)
      .collection('placed_objects')
      .doc(event.relatedObjectId);

    const objSnap = await objRef.get();
    if (!objSnap.exists) {
      // Object was deleted — drop the event so we stop scanning it.
      await doc.ref.update({ status: 'overdue', overdueAt: now.toISOString() });
      eventsFlipped += 1;
      skipped += 1;
      continue;
    }

    const obj = (objSnap.data() ?? {}) as { lifecycle?: string };

    if (obj.lifecycle && ACTIVE_LIFECYCLES.has(obj.lifecycle)) {
      await objRef.update({
        lifecycle: 'maintenance_due',
        updatedAt: now.getTime(),
      });
      updated += 1;
    } else {
      // retired / planning / pending_install / maintenance_due → keep
      // the object alone, but still flip the event so the queue moves.
      skipped += 1;
    }

    await doc.ref.update({
      status: 'overdue',
      overdueAt: now.toISOString(),
    });
    eventsFlipped += 1;
  }

  return { updated, eventsFlipped, skipped };
}
