/**
 * Public barrel for the SLM offline namespace.
 *
 * Re-exports the canonical types and the static model registry so the
 * rest of the app can `import { ... } from '@/services/slm'` without
 * reaching into individual modules.
 *
 * Sprint 20:
 *   - Bucket Gamma  T-1.1 — types + registry.
 *   - Bucket Epsilon T-1.2 — IndexedDB cache, loader, Worker proxy.
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
