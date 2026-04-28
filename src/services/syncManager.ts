import { writeBatch, doc } from 'firebase/firestore';
import { db } from './firebase';
import { generateEmbeddingsBatch, autoConnectNodes, syncBatchToNetwork } from './geminiService';
import { RiskNode } from '../types';
import { get, set, del } from 'idb-keyval';
import { logger } from '../utils/logger';

type SyncOperation = 
  | { type: 'set', id: string, data: RiskNode }
  | { type: 'update', id: string, data: Partial<RiskNode> }
  | { type: 'delete', id: string };

const SYNC_QUEUE_KEY = 'guardian_sync_queue';

class MatrixSyncManager {
  private queue: Map<string, SyncOperation> = new Map();
  private flushInterval: any = null;
  private isFlushing = false;
  private flushDelayMs = 5000; // 5 seconds batching window
  private listeners: (() => void)[] = [];
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
   * Restore an operation back into the queue from outside (e.g. after a UI
   * "restore server version" decision that needs to retry the local write).
   * Public surface so components can request a retry/restore without poking
   * at internals. NOTE: this is a stub — full implementation requires reading
   * the server doc and reconstructing the local state. See restoreServerVersion.
   */
  async restoreServerVersion(_collection: string, _docId: string, _serverData: unknown): Promise<void> {
    // TODO(sync-restore): src/services/syncManager.ts — implement server-state restore.
    // Should: 1) fetch authoritative server doc, 2) rewrite local store with it,
    // 3) drop any pending op for this docId from the queue so we don't re-clobber.
    logger.warn('SyncManager.restoreServerVersion called but not implemented', { _collection, _docId });
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
