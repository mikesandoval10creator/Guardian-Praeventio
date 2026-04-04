import { writeBatch, doc } from 'firebase/firestore';
import { db } from './firebase';
import { generateEmbeddingsBatch, autoConnectNodes } from './geminiService';
import { RiskNode } from '../types';

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
    this.loadQueue();
    
    // Listen for online events to trigger flush
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[SyncManager] Back online. Flushing queue...');
        this.flush();
      });
    }
  }

  private loadQueue() {
    try {
      const stored = localStorage.getItem(SYNC_QUEUE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.queue = new Map(parsed);
        console.log(`[SyncManager] Loaded ${this.queue.size} operations from local storage.`);
        if (this.queue.size > 0 && navigator.onLine) {
          this.scheduleFlush();
        }
      }
    } catch (e) {
      console.error('[SyncManager] Error loading queue from local storage:', e);
    }
  }

  private saveQueue() {
    try {
      const serialized = JSON.stringify(Array.from(this.queue.entries()));
      localStorage.setItem(SYNC_QUEUE_KEY, serialized);
    } catch (e) {
      console.error('[SyncManager] Error saving queue to local storage:', e);
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

  enqueueSet(node: RiskNode) {
    this.queue.set(node.id, { type: 'set', id: node.id, data: node });
    this.saveQueue();
    this.notifyListeners();
    this.scheduleFlush();
  }

  enqueueUpdate(id: string, updates: Partial<RiskNode>) {
    const existing = this.queue.get(id);
    if (existing && existing.type === 'set') {
      this.queue.set(id, { type: 'set', id, data: { ...existing.data, ...updates } });
    } else if (existing && existing.type === 'update') {
      this.queue.set(id, { type: 'update', id, data: { ...existing.data, ...updates } });
    } else {
      this.queue.set(id, { type: 'update', id, data: updates });
    }
    this.saveQueue();
    this.notifyListeners();
    this.scheduleFlush();
  }

  enqueueDelete(id: string) {
    this.queue.set(id, { type: 'delete', id });
    this.saveQueue();
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
      this.queue.clear(); // Clear early to accept new operations
      this.saveQueue();
      this.notifyListeners(); // Notify that queue is cleared
      
      // 1. Process Embeddings in Batch
      const nodesNeedingEmbeddings: { id: string, text: string, opIndex: number }[] = [];
      
      operationsToFlush.forEach((op, index) => {
        if (op.type === 'set') {
          const text = `${op.data.title} ${op.data.description} ${op.data.tags.join(' ')}`;
          nodesNeedingEmbeddings.push({ id: op.id, text, opIndex: index });
        } else if (op.type === 'update' && (op.data.title || op.data.description || op.data.tags)) {
          const existingNodes = this.getNodes();
          const node = existingNodes.find(n => n.id === op.id);
          if (node) {
            const title = op.data.title || node.title;
            const desc = op.data.description || node.description;
            const tags = op.data.tags || node.tags;
            const text = `${title} ${desc} ${tags.join(' ')}`;
            nodesNeedingEmbeddings.push({ id: op.id, text, opIndex: index });
          }
        }
      });

      if (nodesNeedingEmbeddings.length > 0) {
        const texts = nodesNeedingEmbeddings.map(n => n.text);
        const embeddings = await generateEmbeddingsBatch(texts);
        
        embeddings.forEach((emb, i) => {
          if (emb && emb.length > 0) {
            const opIndex = nodesNeedingEmbeddings[i].opIndex;
            const op = operationsToFlush[opIndex];
            if (op.type === 'set') {
              op.data.embedding = emb;
            } else if (op.type === 'update') {
              op.data.embedding = emb;
            }
          }
        });
      }

      // 2. Execute Firestore Batch Write
      const batch = writeBatch(db);
      
      for (const op of operationsToFlush) {
        const docRef = doc(db, 'nodes', op.id);
        if (op.type === 'set') {
          batch.set(docRef, op.data);
        } else if (op.type === 'update') {
          batch.update(docRef, op.data);
        } else if (op.type === 'delete') {
          batch.delete(docRef);
        }
      }
      
      await batch.commit();
      console.log(`[SyncManager] Flushed ${operationsToFlush.length} operations to Firestore in a single batch.`);

      // 3. Post-flush Auto-connect for new nodes
      const newNodes = operationsToFlush.filter(op => op.type === 'set').map(op => (op as any).data as RiskNode);
      if (newNodes.length > 0) {
        const existingNodes = this.getNodes();
        for (const newNode of newNodes) {
           autoConnectNodes(newNode, existingNodes).then(async (connections) => {
             if (!connections || connections.length === 0) return;
             
             const timeNow = new Date().toISOString();
             const newConnections1 = [...(newNode.connections || []), ...connections];
             
             // Enqueue connection updates to be batched in the next flush
             this.enqueueUpdate(newNode.id, { connections: Array.from(new Set(newConnections1)), updatedAt: timeNow });
             
             for (const targetId of connections) {
               if (targetId !== newNode.id) {
                 const targetNode = existingNodes.find(n => n.id === targetId);
                 if (targetNode && !targetNode.connections.includes(newNode.id)) {
                   const newConnections2 = [...(targetNode.connections || []), newNode.id];
                   this.enqueueUpdate(targetId, { connections: newConnections2, updatedAt: timeNow });
                 }
               }
             }
           }).catch(console.error);
        }
      }

    } catch (error) {
      console.error("[SyncManager] Error flushing sync queue:", error);
      // Restore operations to queue
      const newOperations = Array.from(this.queue.values()); // Get any new operations added during flush
      this.queue.clear();
      
      // Re-add failed operations first, then new ones
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
