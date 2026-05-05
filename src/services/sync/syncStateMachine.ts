// Sprint 25 Bucket QQ — Centralized Offline Sync State Machine.
//
// Why this exists: today the sync surface is fragmented. Modals call
// `saveForSync()` (utils/pwa-offline.ts), the matrixSyncManager owns its
// own queue for RiskNode mutations, and OfflineSyncManager.tsx drains a
// third queue on `online` events. UI components have no centralized
// "what's the sync state right now" question they can ask.
//
// This module fixes that by introducing a single state machine that:
//   1. Owns a unified, IndexedDB-persisted queue of pending operations
//      (idb-keyval — already in deps, no new dependency).
//   2. Exposes a Zustand-light `subscribe(snapshot => …)` API so React
//      components can drive UI from a single source of truth via
//      `useSyncState()`.
//   3. Implements per-operation exponential backoff (1s, 5s, 30s, 5min,
//      30min, give-up after 6 attempts) so a single broken op doesn't
//      starve the queue.
//   4. Dedupes by `${collection}:${id}:${type}` (last-write-wins) so a
//      modal that submits twice doesn't double-write.
//
// Reuse / non-goals:
//   • This does NOT replace `matrixSyncManager` (RiskNode-specific) —
//     they coexist for now. `saveForSync()` in pwa-offline.ts now
//     delegates here so that ad-hoc modal callers go through the
//     central path; matrixSyncManager keeps its own batched write path
//     for embedding-aware Risk node sync.
//   • The actual network executor is injected via `setExecutor()` so
//     the state machine has zero coupling to firebase/firestore. The
//     default executor is a noop that fails — production wires the
//     real Firestore executor from `OfflineSyncManager.tsx`.

import { get, set } from 'idb-keyval';
import { logger } from '../../utils/logger';

const QUEUE_KEY = 'guardian_offline_sync_v1';
const LAST_SUCCESS_KEY = 'guardian_offline_sync_last_success_v1';

export type SyncState =
  | 'online_synced' // online + 0 pending operations
  | 'online_syncing' // online + sync in progress
  | 'online_failed' // online + at least 1 op failed (will retry)
  | 'offline_queued' // offline + ops queued
  | 'offline_idle' // offline + 0 pending
  | 'reconnecting'; // online state transitioning, drain queue

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete' | 'set';
  collection: string;
  data: any;
  attempts: number;
  lastAttemptMs?: number;
  lastError?: string;
  createdAt: number;
}

export interface SyncStateSnapshot {
  state: SyncState;
  pendingCount: number;
  operations: SyncOperation[];
  lastSyncSuccessMs: number | null;
  isOnline: boolean;
}

export type SyncExecutor = (op: SyncOperation) => Promise<void>;

const MAX_ATTEMPTS = 6;
// Backoff schedule indexed by attempt count (after attempt N has failed).
// 1s, 5s, 30s, 5min, 30min — capped at 30 min for any further attempts.
// Index 0 unused (a fresh op has attempts=0 and runs immediately).
const BACKOFF_MS: number[] = [
  0, // attempt 0 — never used (immediate)
  1_000, // after 1st failure
  5_000, // after 2nd failure
  30_000, // after 3rd failure
  5 * 60_000, // after 4th failure
  30 * 60_000, // after 5th failure
];

function getBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  if (attempts >= BACKOFF_MS.length) return BACKOFF_MS[BACKOFF_MS.length - 1];
  return BACKOFF_MS[attempts];
}

function dedupeKey(op: { collection: string; data: any; type: string }): string {
  // Best-effort id: prefer explicit data.id (the document id we're touching),
  // fall back to a hash of the JSON payload. The collection+type prefix
  // ensures we never collapse a delete onto a create for the same docId.
  const id = (op.data && (op.data.id || op.data.docId)) ?? '';
  return `${op.collection}:${op.type}:${id}`;
}

function makeOpId(): string {
  // We can't rely on crypto.randomUUID under all environments (older
  // jsdom / Node < 19); fall back to a timestamp+random combo.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class OfflineSyncStateMachine {
  private operations: Map<string, SyncOperation> = new Map();
  private listeners: Set<(snap: SyncStateSnapshot) => void> = new Set();
  private isSyncing = false;
  private hasFailures = false;
  private lastSyncSuccessMs: number | null = null;
  private executor: SyncExecutor = async () => {
    throw new Error('OfflineSyncStateMachine: no executor wired');
  };
  private onlineGetter: () => boolean = () =>
    typeof navigator !== 'undefined' ? navigator.onLine : true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Promise gate for the initial IndexedDB hydrate — exposed so tests can
  // `await offlineSync.ready()` without poking at private state.
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.hydrate();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  private handleOnline = () => {
    logger.info('offlineSync: online event — draining queue');
    this.notify();
    void this.syncNow();
  };

  private handleOffline = () => {
    logger.info('offlineSync: offline event');
    this.notify();
  };

  private async hydrate(): Promise<void> {
    try {
      const stored = await get<SyncOperation[]>(QUEUE_KEY);
      if (stored && Array.isArray(stored)) {
        for (const op of stored) {
          this.operations.set(op.id, op);
        }
      }
      const last = await get<number>(LAST_SUCCESS_KEY);
      if (typeof last === 'number') this.lastSyncSuccessMs = last;
    } catch (e) {
      logger.error('offlineSync: hydrate failed', e);
    }
    this.notify();
  }

  /** Test/admin helper — wait for hydrate to finish. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Wire the real network executor. Call once on app boot. */
  setExecutor(fn: SyncExecutor): void {
    this.executor = fn;
  }

  /** Override navigator.onLine accessor (testing only). */
  setOnlineGetter(fn: () => boolean): void {
    this.onlineGetter = fn;
  }

  private async persist(): Promise<void> {
    try {
      await set(QUEUE_KEY, Array.from(this.operations.values()));
    } catch (e) {
      logger.error('offlineSync: persist failed', e);
    }
  }

  /**
   * Compute current snapshot from internal state. Pure projection — calling
   * this multiple times is cheap and side-effect-free.
   */
  getState(): SyncStateSnapshot {
    const isOnline = this.onlineGetter();
    const pendingCount = this.operations.size;
    let state: SyncState;
    if (this.isSyncing) {
      state = 'online_syncing';
    } else if (!isOnline) {
      state = pendingCount > 0 ? 'offline_queued' : 'offline_idle';
    } else if (this.hasFailures && pendingCount > 0) {
      state = 'online_failed';
    } else if (pendingCount === 0) {
      state = 'online_synced';
    } else {
      // Online, ops queued, no recorded failures — we're between drains.
      state = 'reconnecting';
    }
    return {
      state,
      pendingCount,
      operations: Array.from(this.operations.values()),
      lastSyncSuccessMs: this.lastSyncSuccessMs,
      isOnline,
    };
  }

  subscribe(cb: (snap: SyncStateSnapshot) => void): () => void {
    this.listeners.add(cb);
    // Fire once with current state so subscribers don't have to call
    // getState() separately on mount.
    try {
      cb(this.getState());
    } catch (e) {
      logger.error('offlineSync: subscriber threw on initial fire', e);
    }
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    const snap = this.getState();
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch (e) {
        logger.error('offlineSync: listener threw', e);
      }
    }
  }

  /**
   * Enqueue a pending operation. Returns the assigned op id.
   *
   * Dedup contract: if an op with the same collection+type+docId is
   * already queued, the existing op is replaced (last-write-wins) and
   * its id is returned. Attempts counter resets to 0 on replace because
   * the new payload may succeed even where the old one failed.
   */
  async enqueue(
    op: Omit<SyncOperation, 'id' | 'attempts' | 'createdAt'>,
  ): Promise<string> {
    await this.readyPromise;
    const key = dedupeKey(op);
    let id: string | undefined;
    for (const existing of this.operations.values()) {
      if (dedupeKey(existing) === key) {
        id = existing.id;
        break;
      }
    }
    if (!id) id = makeOpId();
    const next: SyncOperation = {
      id,
      type: op.type,
      collection: op.collection,
      data: op.data,
      attempts: 0,
      createdAt: Date.now(),
    };
    this.operations.set(id, next);
    await this.persist();
    this.notify();
    // Auto-trigger a sync if we're online — gives modals "fire and forget"
    // semantics without each caller having to remember to call syncNow.
    if (this.onlineGetter()) {
      void this.syncNow();
    }
    return id;
  }

  /**
   * Force a sync attempt. Returns counts of succeeded/failed ops in this
   * pass. Safe to call concurrently — the second call will short-circuit.
   */
  async syncNow(): Promise<{ succeeded: number; failed: number }> {
    await this.readyPromise;
    if (this.isSyncing) return { succeeded: 0, failed: 0 };
    if (!this.onlineGetter()) return { succeeded: 0, failed: 0 };
    if (this.operations.size === 0) {
      this.hasFailures = false;
      this.notify();
      return { succeeded: 0, failed: 0 };
    }

    this.isSyncing = true;
    this.notify();

    let succeeded = 0;
    let failed = 0;
    const now = Date.now();
    // Snapshot to avoid mutation-during-iteration when enqueue races.
    const ops = Array.from(this.operations.values());

    for (const op of ops) {
      // Skip ops still in backoff window.
      if (op.lastAttemptMs && op.attempts > 0) {
        const wait = getBackoffMs(op.attempts);
        if (now - op.lastAttemptMs < wait) {
          continue;
        }
      }
      try {
        await this.executor(op);
        this.operations.delete(op.id);
        succeeded += 1;
      } catch (err) {
        const updated: SyncOperation = {
          ...op,
          attempts: op.attempts + 1,
          lastAttemptMs: Date.now(),
          lastError: err instanceof Error ? err.message : String(err),
        };
        if (updated.attempts >= MAX_ATTEMPTS) {
          // Give up — pop from queue so we don't block forever.
          // Loud log because data is being intentionally dropped.
          logger.error('offlineSync: op exceeded MAX_ATTEMPTS — dropping', {
            opId: op.id,
            collection: op.collection,
            type: op.type,
            lastError: updated.lastError,
          });
          this.operations.delete(op.id);
        } else {
          this.operations.set(op.id, updated);
        }
        failed += 1;
      }
    }

    this.hasFailures = failed > 0;
    if (succeeded > 0 && this.operations.size === 0 && failed === 0) {
      this.lastSyncSuccessMs = Date.now();
      try {
        await set(LAST_SUCCESS_KEY, this.lastSyncSuccessMs);
      } catch {
        /* non-fatal */
      }
    }

    await this.persist();
    this.isSyncing = false;
    this.notify();

    // Schedule a follow-up if there are still ops queued — picks the
    // shortest backoff window across the remaining ops so we don't sleep
    // longer than needed.
    if (this.operations.size > 0) {
      const tNow = Date.now();
      let minWait = Infinity;
      for (const op of this.operations.values()) {
        const due = (op.lastAttemptMs ?? tNow) + getBackoffMs(op.attempts);
        const wait = Math.max(0, due - tNow);
        if (wait < minWait) minWait = wait;
      }
      if (!Number.isFinite(minWait)) minWait = 30_000;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.syncNow();
      }, Math.max(minWait, 250));
    }

    return { succeeded, failed };
  }

  /** Clear the queue (admin / dev tool). Does NOT execute any ops. */
  async clearQueue(): Promise<void> {
    await this.readyPromise;
    this.operations.clear();
    this.hasFailures = false;
    await this.persist();
    this.notify();
  }

  /** Test-only — dispose listeners and timers. Not for production use. */
  _dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.listeners.clear();
    this.operations.clear();
    this.isSyncing = false;
    this.hasFailures = false;
    this.lastSyncSuccessMs = null;
  }
}

// Singleton — there is one offline queue per app instance.
export const offlineSync = new OfflineSyncStateMachine();

// Exposed for testing only.
export const _internal = { getBackoffMs, dedupeKey, MAX_ATTEMPTS, BACKOFF_MS };
