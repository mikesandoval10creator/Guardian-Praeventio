import { writeBatch, doc } from 'firebase/firestore';
import { db } from './firebase';
import { generateEmbeddingsBatch, autoConnectNodes, syncBatchToNetwork } from './geminiService';
import { RiskNode } from '../types';
import { get, set, del } from 'idb-keyval';

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
        console.log('[SyncManager] Back online. Flushing queue...');
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
        console.log(`[SyncManager] Loaded ${this.queue.size} operations from IndexedDB.`);
        if (this.queue.size > 0 && navigator.onLine) {
          this.scheduleFlush();
        }
      }
    } catch (e) {
      console.error('[SyncManager] Error loading queue from IndexedDB:', e);
    }
  }

  private async saveQueue() {
    try {
      const serialized = Array.from(this.queue.entries());
      await set(SYNC_QUEUE_KEY, serialized);
    } catch (e) {
      console.error('[SyncManager] Error saving queue to IndexedDB:', e);
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
      console.log('[SyncManager] Offline. Flush deferred.');
      return;
    }

    this.isFlushing = true;
    
    let operationsToFlush: SyncOperation[] = [];
    try {
      operationsToFlush = Array.from(this.queue.values());
      this.queue.clear();
      this.saveQueue();
      this.notifyListeners();
      
      // Call the backend batch sync which handles:
      // 1. Embedding generation if needed
      // 2. Firestore saves
      // 3. Vector Store (RAG) updates
      // 4. Admin-level bidirectional connections
      const result = await syncBatchToNetwork(operationsToFlush);
      
      if (result.success) {
        console.log(`[SyncManager] Backend batch flush complete for ${operationsToFlush.length} operations.`);
      } else {
        throw new Error(result.error || 'Backend sync failed');
      }

    } catch (error) {
      console.error("[SyncManager] Error flushing sync queue via backend:", error);
      // Restore failed operations
      const newOperations = Array.from(this.queue.values());
      this.queue.clear();
      for (const op of operationsToFlush) {
        this.queue.set(op.id, op);
      }
      for (const op of newOperations) {
        this.queue.set(op.id, op);
      }
      this.saveQueue();
      this.notifyListeners();
    } finally {
      this.isFlushing = false;
      this.flushInterval = null;
      if (this.queue.size > 0) {
        this.scheduleFlush();
      }
    }
  }
}

export const matrixSyncManager = new MatrixSyncManager();
