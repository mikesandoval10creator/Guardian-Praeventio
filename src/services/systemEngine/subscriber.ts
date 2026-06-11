// SystemEngine — Subscriber.
//
// `useSystemEvent(filter, cb)` is the only client-side subscription path.
// Under the hood it's `onSnapshot` on `projects/{projectId}/system_events`,
// so all the existing Firestore replication / IndexedDB persistence
// guarantees apply automatically — no extra infrastructure.
//
// A4 re-scope (2026-06): the subscription used to target
// `tenants/{tid}/system_events`, a path firestore.rules default-denied and
// whose tenant key (`__GP_TENANT_ID__`) no install ever assigned — every
// snapshot returned nothing. The bus is now keyed by the SELECTED PROJECT
// (the app's real tenancy unit, gated by `isProjectMember()`); without a
// projectId the hook stays explicitly local-only.
//
// `onLocalEmit` (from eventLog) is always wired in so callers see
// in-process emits before (or instead of) the Firestore round-trip.

import { useEffect, useRef } from 'react';
import { collection, onSnapshot, orderBy, query, where, limit, type QueryConstraint, type Unsubscribe } from 'firebase/firestore';

import { db } from '../firebase';
import { logger } from '../../utils/logger';
import { onLocalEmit } from './eventLog';
import { isSystemEvent, type SystemEvent, type SystemEventType } from './eventTypes';

export interface SubscribeFilter {
  /**
   * Path key for the Firestore bus (`projects/{projectId}/system_events`).
   * Omitted/empty → local-only mode: in-process emits are still delivered,
   * but no Firestore subscription is opened (explicit, not erroring).
   */
  projectId?: string;
  /** Informational filter — matched against the event payload, not the path. */
  tenantId?: string;
  types?: SystemEventType[];
  /** Max snapshot size; default 100 (bus is high-frequency, UI rarely needs more). */
  pageSize?: number;
}

export type SubscribeCallback = (event: SystemEvent) => void;

/**
 * React hook. Subscribes to `projects/{projectId}/system_events` and invokes
 * `cb` for every new event matching the filter. Auto-cleanup on unmount.
 * Without a `projectId` only in-process emits are delivered (local-only).
 */
export function useSystemEvent(
  filter: SubscribeFilter,
  cb: SubscribeCallback,
): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  // Stable dep key so we don't tear down/up onSnapshot on every render.
  const depKey = JSON.stringify({
    t: filter.tenantId ?? null,
    types: filter.types?.slice().sort() ?? null,
    p: filter.projectId ?? null,
    n: filter.pageSize ?? 100,
  });

  useEffect(() => {
    const unsubLocal = onLocalEmit((event) => {
      if (!matches(event, filter)) return;
      try { cbRef.current(event); } catch (err) {
        logger.warn('systemEngine.subscriber: cb threw on local emit', { err: String(err) });
      }
    });

    // No project selected → local-only mode by design: skip the Firestore
    // subscription entirely (no dead onSnapshot, no permission noise).
    if (!filter.projectId) {
      return () => {
        unsubLocal();
      };
    }

    let unsubFirestore: Unsubscribe | null = null;
    try {
      const constraints: QueryConstraint[] = [orderBy('ts', 'desc'), limit(filter.pageSize ?? 100)];
      if (filter.types && filter.types.length > 0) {
        // `in` accepts ≤30 values per Firestore. We chunk only if needed.
        constraints.push(where('type', 'in', filter.types.slice(0, 30)));
      }
      const q = query(collection(db, `projects/${filter.projectId}/system_events`), ...constraints);
      unsubFirestore = onSnapshot(
        q,
        (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type !== 'added') continue;
            const data = change.doc.data();
            if (!isSystemEvent(data)) continue;
            try { cbRef.current(data); } catch (err) {
              logger.warn('systemEngine.subscriber: cb threw on snapshot', { err: String(err) });
            }
          }
        },
        (err) => {
          logger.warn('systemEngine.subscriber: snapshot error', { err: String(err) });
        },
      );
    } catch (err) {
      logger.warn('systemEngine.subscriber: setup failed', { err: String(err) });
    }

    return () => {
      unsubLocal();
      if (unsubFirestore) unsubFirestore();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);
}

function matches(event: SystemEvent, filter: SubscribeFilter): boolean {
  if (filter.tenantId && event.tenantId !== filter.tenantId) return false;
  if (filter.projectId && event.projectId !== filter.projectId) return false;
  if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) return false;
  return true;
}
