import { writeBatch, doc } from 'firebase/firestore';
import { db } from './firebase';
// `autoConnectNodes` was previously imported here but never invoked
// (Round 14 A2 dead-code finding). It is now wired into the server-side
// `syncNodeToNetwork` step in `services/networkBackend.ts`, where the
// recent-nodes lookup runs against Firestore admin instead of the
// client-side cache. See that file's step 5 comment for rationale.
import { generateEmbeddingsBatch, syncBatchToNetwork } from './geminiService';
import { RiskNode } from '../types';
import { get, set, del } from 'idb-keyval';
import { logger } from '../utils/logger';

type SyncOperation = 
  | { type: 'set', id: string, data: RiskNode }
  | { type: 'update', id: string, data: Partial<RiskNode> }
  | { type: 'delete', id: string };

const SYNC_QUEUE_KEY = 'guardian_sync_queue';

export interface RestoreEvent {
  collection: string;
  docId: string;
  serverData: unknown;
}

class MatrixSyncManager {
  private queue: Map<string, SyncOperation> = new Map();
  private flushInterval: any = null;
  private isFlushing = false;
  private flushDelayMs = 5000; // 5 seconds batching window
  private listeners: (() => void)[] = [];
  // Separate listener list for restore-server-version events. Kept distinct
  // from the queue-change listeners so callers (the conflict banner / IPER
  // viewer) can re-fetch only when *they* asked for a rollback, not on every
  // routine queue mutation.
  private restoreListeners: ((event: RestoreEvent) => void)[] = [];
  // Backoff state: number of consecutive failed flush cycles. Reset to 0 on success.
  private retryAttempt = 0;

  constructor() {
    this.init();
    
    // Listen for online events to trigger flush
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        logger.info('Back online — flushing sync queue');
        this.flush();
      });
    }
  }

  private async init() {
    await this.loadQueue();
  }

  private async loadQueue() {
    try {
      const stored = await get<[string, SyncOperation][]>(SYNC_QUEUE_KEY);
      if (stored) {
        this.queue = new Map(stored);
        logger.debug(`SyncManager loaded ${this.queue.size} operations from IndexedDB`);
        if (this.queue.size > 0 && navigator.onLine) {
          this.scheduleFlush();
        }
      }
    } catch (e) {
      logger.error('SyncManager: error loading queue from IndexedDB', e);
    }
  }

  private async saveQueue() {
    try {
      const serialized = Array.from(this.queue.entries());
      await set(SYNC_QUEUE_KEY, serialized);
    } catch (e) {
      logger.error('SyncManager: error saving queue to IndexedDB', e);
    }
  }

  // Provide access to current nodes for auto-connect and updates
  private getNodes: () => RiskNode[] = () => [];

  setNodesProvider(provider: () => RiskNode[]) {
    this.getNodes = provider;
  }

  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(l => l());
  }

  async enqueueSet(node: RiskNode) {
    this.queue.set(node.id, { type: 'set', id: node.id, data: node });
    await this.saveQueue();
    this.notifyListeners();
    this.scheduleFlush();
  }

  async enqueueUpdate(id: string, updates: Partial<RiskNode>) {
    const existing = this.queue.get(id);
    if (existing && existing.type === 'set') {
      this.queue.set(id, { type: 'set', id, data: { ...existing.data, ...updates } });
    } else if (existing && existing.type === 'update') {
      this.queue.set(id, { type: 'update', id, data: { ...existing.data, ...updates } });
    } else {
      this.queue.set(id, { type: 'update', id, data: updates });
    }
    await this.saveQueue();
    this.notifyListeners();
    this.scheduleFlush();
  }

  async enqueueDelete(id: string) {
    this.queue.set(id, { type: 'delete', id });
    await this.saveQueue();
    this.notifyListeners();
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (!this.flushInterval) {
      this.flushInterval = setTimeout(() => this.flush(), this.flushDelayMs);
    }
  }

  getPendingOperations() {
    return Array.from(this.queue.values());
  }

  /**
   * Subscribe to restore events. Listeners are notified whenever
   * {@link restoreServerVersion} is invoked, so they can re-fetch the
   * authoritative server document and replace their local state.
   *
   * Returns an unsubscribe function.
   */
  onRestore(listener: (event: RestoreEvent) => void): () => void {
    this.restoreListeners.push(listener);
    return () => {
      this.restoreListeners = this.restoreListeners.filter(l => l !== listener);
    };
  }

  private notifyRestore(event: RestoreEvent) {
    for (const l of this.restoreListeners) {
      try {
        l(event);
      } catch (e) {
        // A misbehaving listener must not break sibling listeners or the
        // restore flow — log and continue.
        logger.error('SyncManager: restore listener threw', e);
      }
    }
  }

  /**
   * Restore the server version of a document, abandoning any local pending
   * write for that document.
   *
   * Contract:
   *   1. Drops any queued op (`set`/`update`/`delete`) whose id matches
   *      `docId` — the local edit is intentionally discarded.
   *   2. Emits a `restore` event (see {@link onRestore}). Subscribers are
   *      expected to re-fetch the authoritative server document from
   *      Firestore and rewrite their in-memory + IndexedDB/SQLite caches
   *      from the result.
   *
   * Why the cache write is delegated upstream: the local persistence layer
   * (IndexedDB via `idb` for web, Capacitor SQLite for native) is owned by
   * `pwa-offline.ts` and the per-feature stores. SyncManager only owns the
   * pending-op queue. Performing the cache write here would require this
   * service to know every cache schema in the app — instead, callers
   * receive a notification and refresh from server on their own terms.
   *
   * The `collection` argument is currently used only for the event payload
   * and logging; the queue is keyed by docId because each id is unique
   * across the queue (collection scoping happens upstream).
   */
  async restoreServerVersion(
    collection: string,
    docId: string,
    serverData: unknown,
  ): Promise<void> {
    // (a) Drop any queued op for this docId so the next flush won't re-clobber
    //     the server state we're about to restore.
    if (this.queue.has(docId)) {
      this.queue.delete(docId);
      await this.saveQueue();
      this.notifyListeners();
      logger.info('SyncManager: dropped pending op for restored doc', {
        collection,
        docId,
      });
    }

    // (b) Fan out a restore event so the consumer (banner, IPER UI, etc.)
    //     can re-fetch the authoritative server doc and overwrite its
    //     local caches.
    this.notifyRestore({ collection, docId, serverData });
  }

  async flush() {
    if (this.isFlushing || this.queue.size === 0) return;

    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!isOnline) {
      logger.debug('SyncManager offline — flush deferred');
      return;
    }

    this.isFlushing = true;

    // Snapshot of [id, opReference] pairs taken BEFORE the network await.
    // INVARIANT: only delete an entry from this.queue if the *same object reference*
    // is still there at completion time. If a concurrent enqueue* call replaced
    // the entry while we were awaiting the network (user re-edited the same id),
    // the new op MUST be preserved — it will be flushed on the next cycle.
    // Without this guard, a single delete-by-id silently loses the new edit.
    let snapshot: Array<[string, SyncOperation]> = [];
    try {
      snapshot = Array.from(this.queue.entries());
      this.notifyListeners();

      const operationsToFlush = snapshot.map(([, op]) => op);
      const result = await syncBatchToNetwork(operationsToFlush);

      // Remove only the operations that were confirmed successful AND whose
      // queue entry has not been replaced since the snapshot.
      const failedIds = new Set((result.failedOps ?? []).map((op: { id: string }) => op.id));
      for (const [id, op] of snapshot) {
        if (failedIds.has(id)) continue;
        // Reference identity check — a concurrent enqueue* would have replaced
        // the value with a *different* object. If so, leave it alone.
        if (this.queue.get(id) === op) {
          this.queue.delete(id);
        }
      }
      await this.saveQueue();
      this.notifyListeners();

      if (failedIds.size > 0) {
        logger.warn(`SyncManager: ${failedIds.size} operation(s) failed and will be retried`);
        // Partial failure still increments backoff so we don't hammer the backend.
        this.retryAttempt += 1;
      } else {
        logger.info(`SyncManager: batch flush complete`, { count: operationsToFlush.length });
        // Reset backoff on full success.
        this.retryAttempt = 0;
      }

    } catch (error) {
      logger.error('SyncManager: error flushing sync queue', error);
      // Queue was never cleared — operations are still present, nothing lost.
      this.retryAttempt += 1;
      this.notifyListeners();
    } finally {
      this.isFlushing = false;
      this.flushInterval = null;
      if (this.queue.size > 0) {
        let delay: number;
        if (this.retryAttempt === 0) {
          // Healthy path: short follow-up flush window.
          delay = this.flushDelayMs;
        } else {
          // Exponential backoff with cap (5 min) and jitter (up to +30%).
          // Prevents persistent 5xx from hammering the backend.
          const base = Math.min(15000 * 2 ** (this.retryAttempt - 1), 5 * 60_000);
          const jitter = Math.random() * 0.3 * base;
          delay = base + jitter;
        }
        this.flushInterval = setTimeout(() => this.flush(), delay);
      }
    }
  }
}

export const matrixSyncManager = new MatrixSyncManager();
