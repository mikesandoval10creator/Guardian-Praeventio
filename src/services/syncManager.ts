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

  async flush() {
    if (this.isFlushing || this.queue.size === 0) return;
    
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!isOnline) {
      logger.debug('SyncManager offline — flush deferred');
      return;
    }

    this.isFlushing = true;

    let operationsToFlush: SyncOperation[] = [];
    try {
      // WAL pattern: snapshot queue but do NOT clear until network confirms.
      // This prevents data loss if the app closes between clear() and the
      // network call completing.
      operationsToFlush = Array.from(this.queue.values());
      this.notifyListeners();

      const result = await syncBatchToNetwork(operationsToFlush);

      // Remove only the operations that were confirmed successful.
      const failedIds = new Set((result.failedOps ?? []).map((op: { id: string }) => op.id));
      for (const op of operationsToFlush) {
        if (!failedIds.has(op.id)) {
          this.queue.delete(op.id);
        }
      }
      await this.saveQueue();
      this.notifyListeners();

      if (failedIds.size > 0) {
        logger.warn(`SyncManager: ${failedIds.size} operation(s) failed and will be retried`);
      } else {
        logger.info(`SyncManager: batch flush complete`, { count: operationsToFlush.length });
      }

    } catch (error) {
      logger.error('SyncManager: error flushing sync queue', error);
      // Queue was never cleared — operations are still present, nothing lost.
      this.notifyListeners();
    } finally {
      this.isFlushing = false;
      this.flushInterval = null;
      if (this.queue.size > 0) {
        // Exponential backoff: retry after 15s on failure to avoid hammering
        this.flushInterval = setTimeout(() => this.flush(), Math.min(this.flushDelayMs * 3, 15000));
      }
    }
  }
}

export const matrixSyncManager = new MatrixSyncManager();
