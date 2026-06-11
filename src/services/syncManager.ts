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
import {
  detectConflicts,
  type Conflict,
  type DocSnapshot,
  type PendingAction,
} from './sync/conflictResolver';
import {
  safetyDocTypeForNodeType,
  RESOLVER_DOC_TYPE_BY_SAFETY_TYPE,
} from './sync/safetyCriticalDocTypes';

/**
 * §16.2.2 — set when a safety-critical op diverged from the remote doc.
 * A marked op is RETAINED in the queue (the local version must not be
 * lost) but is never re-flushed: resolution happens via the human flow
 * (`sync-critical-conflict-resolved` / `restoreServerVersion`). Mirrors
 * the `deadLettered` retention pattern in `sync/syncStateMachine.ts`.
 */
export interface SyncConflictMark {
  detectedAt: string;
  serverUpdatedAt: string;
  docType: string;
}

type SyncOperation = (
  | { type: 'set', id: string, data: RiskNode }
  | { type: 'update', id: string, data: Partial<RiskNode> }
  | { type: 'delete', id: string }
) & { conflict?: SyncConflictMark };

const SYNC_QUEUE_KEY = 'guardian_sync_queue';
// The matrixSyncManager queue is RiskNode-only; ops target this collection.
const NODES_COLLECTION = 'nodes';

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
      // §16.2.2 — when the supervisor finishes a manual resolution in the
      // ConflictResolutionDrawer (OfflineSyncManager applies the chosen
      // values to Firestore), drop our retained conflicted op so the stale
      // local version can never replay over the human decision.
      window.addEventListener('sync-critical-conflict-resolved', (e) => {
        const detail = (e as CustomEvent<{ collection?: string; docId?: string }>).detail;
        if (!detail || detail.collection !== NODES_COLLECTION || !detail.docId) return;
        void this.dropResolvedConflict(detail.docId);
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
   * §16.2.2 — ops retained after a safety-critical divergence. They hold
   * the LOCAL version of the document and wait for human resolution; they
   * are never re-flushed automatically.
   */
  getConflictedOperations() {
    return Array.from(this.queue.values()).filter((op) => op.conflict);
  }

  /** Live ops still eligible for flushing (EXCLUDES conflicted ops). */
  private flushableEntries(): Array<[string, SyncOperation]> {
    return Array.from(this.queue.entries()).filter(([, op]) => !op.conflict);
  }

  /**
   * §16.2.2 — drop a conflicted op once the supervisor resolved it (the
   * resolution flow writes the chosen values to Firestore itself). Only
   * removes ops carrying a conflict mark — a fresh local edit enqueued
   * after the conflict is never discarded.
   */
  private async dropResolvedConflict(docId: string): Promise<void> {
    const op = this.queue.get(docId);
    if (!op || !op.conflict) return;
    this.queue.delete(docId);
    await this.saveQueue();
    this.notifyListeners();
    logger.info('SyncManager: dropped conflicted op after human resolution', {
      docId,
      docType: op.conflict.docType,
    });
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

  /**
   * Resolve the metadata needed to classify a queued op: the RiskNode
   * `type` label, the local edit timestamp and the project. Sourced from
   * the op payload itself (`set` carries the full node) with the in-memory
   * nodes provider as fallback (`update`/`delete` payloads are partial).
   */
  private resolveNodeContext(op: SyncOperation): {
    nodeType?: string;
    localUpdatedAt?: string;
    projectId?: string;
  } {
    const fromQueue =
      op.type === 'set' || op.type === 'update'
        ? (op.data as Partial<RiskNode>)
        : undefined;
    const fromStore = this.getNodes().find((n) => n.id === op.id);
    return {
      nodeType: (fromQueue?.type as string | undefined) ?? fromStore?.type,
      localUpdatedAt: fromQueue?.updatedAt ?? fromStore?.updatedAt,
      projectId: fromQueue?.projectId ?? fromStore?.projectId,
    };
  }

  /**
   * §16.2.2 — pre-flush guard for safety-critical doc types
   * (inspection / incident_report / emergency_alert / medical_record /
   * training_completion). Before writing, compare the queued local op
   * against the CURRENT remote document using the same detector the
   * OfflineSyncManager uses (`detectConflicts` on rev/updatedAt + field
   * diff). Verdicts:
   *   • 'clean'    → not a safety doc type, remote missing, or remote not
   *                  newer than our base — flush normally.
   *   • 'conflict' → divergence on a safety doc: NEVER overwrite.
   *   • 'retry'    → remote unreadable: skip this cycle rather than
   *                  blind-writing over an unknown remote state.
   */
  private async checkSafetyCriticalConflict(
    op: SyncOperation,
  ): Promise<
    | { kind: 'clean' }
    | { kind: 'conflict'; conflict: Conflict; projectId?: string }
    | { kind: 'retry' }
  > {
    const ctx = this.resolveNodeContext(op);
    const safetyDocType = safetyDocTypeForNodeType(ctx.nodeType);
    // Non-critical doc types: zero remote reads — behavior unchanged.
    if (!safetyDocType) return { kind: 'clean' };

    let remoteSnap: { exists: () => boolean; data: () => unknown };
    try {
      // Dynamic import mirrors OfflineSyncManager.tsx and keeps getDoc out
      // of the cold-start bundle path.
      const { getDoc } = await import('firebase/firestore');
      remoteSnap = await getDoc(doc(db, NODES_COLLECTION, op.id));
    } catch (err) {
      logger.warn(
        'SyncManager: could not read remote doc for safety-conflict check — deferring op',
        { docId: op.id, error: err },
      );
      return { kind: 'retry' };
    }
    if (!remoteSnap.exists()) return { kind: 'clean' };

    const remoteData = (remoteSnap.data() ?? {}) as Record<string, unknown>;
    const rawUpdatedAt = remoteData.updatedAt as
      | { toDate?: () => Date }
      | string
      | undefined;
    const serverUpdatedAt =
      (typeof rawUpdatedAt === 'object' && rawUpdatedAt?.toDate
        ? rawUpdatedAt.toDate().toISOString()
        : (rawUpdatedAt as string | undefined)) ?? new Date().toISOString();

    const resolverDocType = RESOLVER_DOC_TYPE_BY_SAFETY_TYPE[safetyDocType];
    const pending: PendingAction = {
      docId: op.id,
      collection: NODES_COLLECTION,
      type: op.type,
      data: op.type === 'delete' ? {} : (op.data as Record<string, unknown>),
      // Missing base timestamp → epoch, so ANY remote write counts as
      // divergence. Fail-toward-human-review: a spurious supervisor prompt
      // beats a silent overwrite of safety evidence.
      localUpdatedAt: ctx.localUpdatedAt ?? new Date(0).toISOString(),
      docType: resolverDocType,
    };
    const remote: DocSnapshot = {
      collection: NODES_COLLECTION,
      docId: op.id,
      data: remoteData,
      serverUpdatedAt,
      docType: resolverDocType,
    };
    const conflicts = detectConflicts([pending], [remote]);
    if (conflicts.length === 0) return { kind: 'clean' };
    return { kind: 'conflict', conflict: conflicts[0], projectId: ctx.projectId };
  }

  /**
   * §16.2.2 — divert a safety-critical divergence to the human-resolution
   * flow, preserving BOTH versions:
   *   1. Mark the local op `conflict` (retained, never re-flushed) so the
   *      remote document is left intact and we don't loop-retry.
   *   2. Emit `sync-critical-conflict` (in-session fast path — the
   *      ConflictResolutionDrawer listens, same event OfflineSyncManager
   *      emits).
   *   3. Best-effort POST to the server conflict_queue enqueue endpoint
   *      (durable backstop; the server stamps identity from the verified
   *      token and writes `audit_logs` — see
   *      src/server/routes/conflictQueue.ts).
   */
  private async divertToConflictQueue(
    id: string,
    op: SyncOperation,
    conflict: Conflict,
    projectId?: string,
  ): Promise<void> {
    // Mark FIRST (with the reference-identity guard) so even a crash in the
    // notification path can never lead to a silent overwrite on retry.
    if (this.queue.get(id) === op) {
      this.queue.set(id, {
        ...op,
        conflict: {
          detectedAt: new Date().toISOString(),
          serverUpdatedAt: conflict.serverUpdatedAt,
          docType: String(conflict.docType),
        },
      });
      await this.saveQueue();
      this.notifyListeners();
    }
    logger.warn(
      'SyncManager: safety-critical conflict detected — diverting to human resolution (never last-write-wins)',
      { docId: id, docType: conflict.docType, fields: conflict.fields.length },
    );

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('sync-critical-conflict', { detail: conflict }),
      );
    }

    if (!projectId) {
      logger.warn(
        'SyncManager: no projectId on conflicted node — conflict not persisted to durable queue',
        { docId: id, docType: conflict.docType },
      );
      return;
    }
    try {
      const { apiAuthHeader } = await import('../lib/apiAuth');
      const authHeader = await apiAuthHeader();
      if (authHeader) {
        await fetch(
          `/api/sprint-k/${encodeURIComponent(projectId)}/conflict-queue/enqueue`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({ conflict }),
          },
        );
      } else {
        logger.warn(
          'SyncManager: no auth available — conflict not persisted to durable queue',
          { docId: id },
        );
      }
    } catch (err) {
      // Best-effort: the local mark + window event already preserved both
      // versions; queue persistence retries are the supervisor flow's job.
      logger.warn('SyncManager: failed to persist critical conflict to queue', {
        docId: id,
        error: err,
      });
    }
  }

  async flush() {
    if (this.isFlushing || this.flushableEntries().length === 0) return;

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
    try {
      const snapshot = this.flushableEntries();
      this.notifyListeners();

      // §16.2.2 — divert safety-critical divergences BEFORE any write.
      const toFlush: Array<[string, SyncOperation]> = [];
      for (const [id, op] of snapshot) {
        const verdict = await this.checkSafetyCriticalConflict(op);
        if (verdict.kind === 'conflict') {
          await this.divertToConflictQueue(id, op, verdict.conflict, verdict.projectId);
          continue;
        }
        if (verdict.kind === 'retry') continue; // remote unreadable — try next cycle
        toFlush.push([id, op]);
      }

      if (toFlush.length === 0) {
        // Nothing flushable this cycle (all diverted/deferred) — success
        // path semantics: no backend call happened, so no backoff bump.
        await this.saveQueue();
        this.notifyListeners();
        return;
      }

      const operationsToFlush = toFlush.map(([, op]) => op);
      const result = await syncBatchToNetwork(operationsToFlush);

      // Remove only the operations that were confirmed successful AND whose
      // queue entry has not been replaced since the snapshot.
      const failedIds = new Set((result.failedOps ?? []).map((op: { id: string }) => op.id));
      for (const [id, op] of toFlush) {
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
      // Only live (non-conflicted) ops justify a follow-up flush — conflicted
      // ops are terminal until a human resolves them (§16.2.2), so a queue
      // holding only conflicts must NOT busy-loop.
      if (this.flushableEntries().length > 0) {
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
