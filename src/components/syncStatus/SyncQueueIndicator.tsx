// B16 wire (2026-06) — mounts the (previously orphan) <SyncQueueBadge />
// in the app shell, next to the connectivity indicator (App.tsx renders
// this right alongside <OfflineIndicator />). Sprint 39 H.3 ("Estado
// Sincronización Visible") left the engine + server route ready but the
// badge unrendered: the worker had no way to see what was still pending
// sync. Data source is the REAL central queue (OfflineSyncStateMachine)
// via useSyncQueueStatus — derivation is fully on-device, so the badge
// works exactly when it matters: offline.
//
// Render contract: invisible when the queue is empty (zero shell noise);
// a fixed bottom-right panel when something is pending/failed.

import { useSyncQueueStatus } from '../../hooks/useSyncStatus';
import { offlineSync, type OfflineSyncStateMachine } from '../../services/sync/syncStateMachine';
import { SyncQueueBadge } from './SyncQueueBadge';

interface SyncQueueIndicatorProps {
  /** Test seam — defaults to the app-wide singleton queue. */
  machine?: OfflineSyncStateMachine;
}

export function SyncQueueIndicator({ machine = offlineSync }: SyncQueueIndicatorProps) {
  const { summary, badge, retry } = useSyncQueueStatus(machine);

  if (summary.totalItems === 0) return null;

  return (
    <div
      data-testid="syncStatus.indicator"
      className="fixed bottom-4 right-4 z-[95] w-72 max-w-[calc(100vw-2rem)] shadow-xl"
    >
      <SyncQueueBadge summary={summary} badge={badge} onRetry={retry} />
    </div>
  );
}
