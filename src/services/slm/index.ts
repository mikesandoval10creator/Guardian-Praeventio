/**
 * Public barrel for the SLM offline namespace.
 *
 * Re-exports the canonical types and the static model registry so the
 * rest of the app can `import { ... } from '@/services/slm'` without
 * reaching into individual modules.
 *
 * Sprint 20:
 *   - Bucket Gamma   T-1.1 — types + registry.
 *   - Bucket Epsilon T-1.2 — IndexedDB cache, loader, Worker proxy.
 *   - Bucket Kappa   T-1.4 — main-thread facade, online/offline
 *                            orchestrator, IndexedDB session queue,
 *                            and the queue → Zettelkasten reconciler.
 *
 * The actual worker source (`./worker/slmWorker.ts`) is intentionally
 * NOT re-exported: it's loaded as a separate chunk via `new Worker(...)`
 * inside `createSlmWorker`. Importing it from main-thread code would
 * pull the Comlink + worker bootstrap into the wrong bundle.
 */

export type {
  ModelDescriptor,
  SLMQuery,
  SLMResponse,
  OfflineQueueEntry,
  SLMBackend,
  SLMQuantization,
  SLMFormat,
  SLMLicense,
} from './types';

export {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  getModelById,
  getDefaultModel,
} from './registry';

export {
  cacheModel,
  loadCachedModel,
  getCachedModelBytes,
  deleteCachedModel,
} from './cache/modelCache';

export { loadModel } from './loader';
export type { LoadModelOptions, LoadProgressFn } from './loader';

export { createSlmWorker } from './workerProxy';
export type { SlmWorkerProxy } from './workerProxy';

// T-1.4: main-thread facade — `geminiAdapter`-shaped surface that hides
// the Comlink / model-loading plumbing from call sites.
export {
  ensureSlmReady,
  complete,
  disposeSlm,
  getActiveModelId,
} from './slmAdapter';
export type { SLMAdapterOptions } from './slmAdapter';

// T-1.4: online/offline selector. Wraps slmAdapter.complete + (eventually)
// the server LLM call into one entry point that picks based on
// navigator.onLine, with debug overrides.
export { ask } from './orchestrator';
export type { OrchestratorOptions } from './orchestrator';

// T-1.4: IndexedDB-backed offline session queue. Captures (query,
// response) pairs while offline so they can be replayed once
// connectivity returns.
export {
  enqueueSession,
  listPending,
  markReconciled,
  clearReconciled,
} from './offlineQueue';
export type { QueuedSession } from './offlineQueue';

// T-1.4: Reconciliation pass — drains the queue into the Zettelkasten
// via a caller-supplied write function (kept injectable to avoid a
// hard dep on `src/services/zettelkasten`).
export { reconcileOfflineSessions } from './reconciliation';
export type {
  ReconciliationResult,
  ReconcileOptions,
  ZettelkastenWriteFn,
} from './reconciliation';

// T-1.4.1 (Sprint 20 fifth wave, Bucket Rho) — production runner that
// wires `reconcileOfflineSessions` to the real `writeNodes`. This is
// the ONLY symbol in this barrel that pulls in the Zettelkasten
// dependency graph; the rest stays free of it.
export { runReconciliation } from './reconciliationRunner';
export type { RunReconciliationOptions } from './reconciliationRunner';
