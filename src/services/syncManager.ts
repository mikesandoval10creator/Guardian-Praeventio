import { writeBatch, doc } from 'firebase/firestore';
import { db } from './firebase';
import { generateEmbeddingsBatch, autoConnectNodes } from './geminiService';
import { RiskNode } from '../types';

type SyncOperation = 
  | { type: 'set', id: string, data: RiskNode }
  | { type: 'update', id: string, data: Partial<RiskNode> }
  | { type: 'delete', id: string };

class MatrixSyncManager {
  private queue: Map<string, SyncOperation> = new Map();
  private flushInterval: any = null;
  private isFlushing = false;
  private flushDelayMs = 5000; // 5 seconds batching window
  private listeners: (() => void)[] = [];

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
    this.notifyListeners();
    this.scheduleFlush();
  }

  enqueueDelete(id: string) {
    this.queue.set(id, { type: 'delete', id });
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
    this.isFlushing = true;
    
    try {
      const operations = Array.from(this.queue.values());
      this.queue.clear(); // Clear early to accept new operations
      this.notifyListeners(); // Notify that queue is cleared
      
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

      // 1. Process Embeddings in Batch if online
      if (isOnline) {
        const nodesNeedingEmbeddings: { id: string, text: string, opIndex: number }[] = [];
        
        operations.forEach((op, index) => {
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
              const op = operations[opIndex];
              if (op.type === 'set') {
                op.data.embedding = emb;
              } else if (op.type === 'update') {
                op.data.embedding = emb;
              }
            }
          });
        }
      }

      // 2. Execute Firestore Batch Write
      const batch = writeBatch(db);
      
      for (const op of operations) {
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
      console.log(`[SyncManager] Flushed ${operations.length} operations to Firestore in a single batch.`);

      // 3. Post-flush Auto-connect for new nodes (if online)
      if (isOnline) {
        const newNodes = operations.filter(op => op.type === 'set').map(op => (op as any).data as RiskNode);
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
      }

    } catch (error) {
      console.error("[SyncManager] Error flushing sync queue:", error);
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
