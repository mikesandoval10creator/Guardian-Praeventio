// Sprint 25 Bucket QQ — React hook subscribing to OfflineSyncStateMachine.
//
// Use this hook anywhere a component needs to react to sync state. It is
// the recommended replacement for the older `useOnlineStatus` hook when
// the consumer cares not just about online/offline but also about
// pending-op count, failure state, or last successful sync timestamp.
//
// The hook subscribes once on mount and unsubscribes on unmount. The
// state machine fires the subscriber synchronously with the current
// snapshot during `subscribe()`, so initial-render UI is correct
// without an extra `useEffect`-driven `getState()` call.

import { useEffect, useState } from 'react';
import { offlineSync, SyncStateSnapshot } from '../services/sync/syncStateMachine';

export function useSyncState(): SyncStateSnapshot {
  const [snap, setSnap] = useState<SyncStateSnapshot>(() => offlineSync.getState());

  useEffect(() => {
    // subscribe fires synchronously with the current snapshot — see
    // OfflineSyncStateMachine.subscribe() — which means the initial
    // render after mount and the post-subscribe render are guaranteed
    // consistent. No "first paint shows stale state" flash.
    const unsubscribe = offlineSync.subscribe(setSnap);
    return unsubscribe;
  }, []);

  return snap;
}
