// SystemEngine — Server-side trigger.
//
// Listens to every `system_events` subcollection (collectionGroup — today
// `projects/{pid}/system_events` after the A4 re-scope) via Firestore Admin
// onSnapshot.
// Server-side policies (e.g. those that need admin privileges to fan out
// FCM tokens or write to audit_logs) hook in here. The cleanup function
// is wired into the SIGTERM handler so Cloud Run rolling deploys don't
// leave dangling listeners (closes the spirit of audit hallazgo H10).
//
// This is a Phase 1 implementation: it persists a server-side audit log
// for every system event and exposes a hook for future server-side
// policies. We deliberately do NOT re-run client-side policies on the
// server — those execute in-process when emit() is called, and replaying
// them server-side would double-fire (FCM, notifications, etc.). The
// server trigger is for server-only side effects.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import { isSystemEvent, type SystemEvent } from '../../services/systemEngine/eventTypes.js';

export interface SystemEngineTriggerDeps {
  db: admin.firestore.Firestore;
  /**
   * Optional server-side hook. Invoked once per new event. Throwing here
   * does NOT stop the listener — errors are logged and swallowed so a
   * single bad policy can't take down the trigger.
   */
  onEvent?: (event: SystemEvent) => Promise<void> | void;
}

export interface SystemEngineTriggerHandle {
  unsubscribe: () => void;
}

/**
 * Phase 1 server-side hook (AUDIT-2026-06 B19): persist ONE audit_logs row
 * per system event. This is what the module header always promised, but
 * server.ts never passed an `onEvent`, so the listener validated + deduped
 * and then did nothing. Doc id is derived from the event id, so replays
 * across replicas / reconnects collapse onto the same row (idempotent).
 *
 * `serverTimestamp` is injected (server.ts passes
 * `() => admin.firestore.FieldValue.serverTimestamp()`) so this module
 * stays import-light and unit-testable.
 */
export function makeSystemEventAuditor(
  db: admin.firestore.Firestore,
  serverTimestamp: () => unknown,
): (event: SystemEvent) => Promise<void> {
  return async (event: SystemEvent): Promise<void> => {
    await db
      .collection('audit_logs')
      .doc(`sysevent_${event.id}`)
      .set({
        action: `system_event_${event.type}`,
        module: 'systemEngine',
        userId: event.actorUid ?? 'system',
        tenantId: event.tenantId,
        projectId: event.projectId ?? null,
        eventId: event.id,
        idempotencyKey: event.idempotencyKey,
        eventTs: event.ts,
        timestamp: serverTimestamp(),
      });
  };
}

const seenEventIds = new Set<string>();

export function setupSystemEngineTrigger(
  deps: SystemEngineTriggerDeps,
): SystemEngineTriggerHandle {
  const { db, onEvent } = deps;
  let unsub: () => void = () => {};
  let isInitialLoad = true;

  try {
    unsub = db.collectionGroup('system_events').onSnapshot(
      (snapshot) => {
        if (isInitialLoad) {
          isInitialLoad = false;
          return;
        }

        snapshot.docChanges().forEach(async (change) => {
          if (change.type !== 'added') return;
          const data = change.doc.data();
          if (!isSystemEvent(data)) {
            logger.warn('systemEngineTrigger: rejected malformed event', {
              docId: change.doc.id,
            });
            return;
          }
          if (seenEventIds.has(data.id)) return;
          seenEventIds.add(data.id);
          // Cap the dedup set; events older than ~1h are irrelevant in this
          // server-side replay context.
          if (seenEventIds.size > 5000) {
            const toEvict = seenEventIds.size - 4000;
            let i = 0;
            for (const id of seenEventIds) {
              if (i++ >= toEvict) break;
              seenEventIds.delete(id);
            }
          }

          if (onEvent) {
            try {
              await onEvent(data);
            } catch (err) {
              logger.warn('systemEngineTrigger: onEvent threw', {
                err: String(err),
                eventType: data.type,
                eventId: data.id,
              });
            }
          }
        });
      },
      (err) => {
        logger.warn('systemEngineTrigger: snapshot error', { err: String(err) });
      },
    );
  } catch (err) {
    logger.warn('systemEngineTrigger: setup failed', { err: String(err) });
  }

  return {
    unsubscribe: () => {
      try {
        unsub();
      } catch (err) {
        logger.warn('systemEngineTrigger: unsubscribe failed', { err: String(err) });
      }
    },
  };
}
