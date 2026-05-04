/**
 * Main-thread facade for the SLM Web Worker.
 *
 * Fase 1 (Sprint 20, Bucket Kappa, T-1.4). Sits between application code
 * and the worker proxy, providing a `geminiAdapter`-shaped surface so
 * call sites can swap between server LLM and on-device SLM without
 * caring about Comlink, model loading, or Worker lifecycle.
 *
 * Singleton-by-design: the module owns one `SlmWorkerProxy` and the id
 * of the model that proxy was initialized against. `ensureSlmReady`
 * is idempotent for the same `modelId`, so call sites can invoke it
 * defensively before every `complete()` without paying a re-init cost.
 *
 * What this module deliberately does NOT do:
 *   - It does not pick between on-device SLM and server Gemini — that's
 *     `orchestrator.ts` (Bucket Kappa, T-1.4).
 *   - It does not persist offline sessions — that's `offlineQueue.ts`.
 *   - It does not run inference itself — the worker (and, in T-1.5,
 *     onnxruntime-web inside the worker) does that.
 */

import { loadModel } from './loader';
import { getDefaultModel, getModelById } from './registry';
import type { ModelDescriptor, SLMQuery, SLMResponse } from './types';
import { createSlmWorker, type SlmWorkerProxy } from './workerProxy';

/**
 * Module-scoped state. The worker proxy is held across calls so the
 * loaded `InferenceSession` (T-1.5) survives between `complete()` invocations.
 *
 * `_activeModelId` doubles as a cheap "is the worker initialized for THIS
 * model?" check; if it differs from the requested id, `ensureSlmReady`
 * re-initializes the worker with the new model bytes.
 */
let _worker: SlmWorkerProxy | null = null;
let _activeModelId: string | null = null;

/**
 * Optional inputs accepted by `ensureSlmReady` and `complete`.
 *
 * `modelId` defaults to the registry's default model (`phi-3-mini`). The
 * `onProgress` hook is forwarded to the loader so UI can show a download
 * bar on first launch (and is silently dropped on cache hits).
 */
export interface SLMAdapterOptions {
  /** Registry id of the model to ensure is loaded. Defaults to the registry default. */
  modelId?: string;
  /**
   * Forwarded to `loadModel()`. Fires while bytes are streaming from the
   * network on first launch; never fires when the cache is warm.
   */
  onProgress?: (loaded: number, total: number | null) => void;
}

/**
 * Lazy worker accessor for tests. Tests need to swap this for a stub
 * without instantiating a real `Worker` (which jsdom can't construct
 * with `new URL(..., import.meta.url)` semantics).
 *
 * @internal
 */
let _createWorker: () => SlmWorkerProxy = createSlmWorker;

/**
 * Test-only injection point. Replaces the worker factory. Pass `null`
 * to restore the production factory.
 *
 * @internal
 */
export function __setWorkerFactoryForTests(
  factory: (() => SlmWorkerProxy) | null,
): void {
  _createWorker = factory ?? createSlmWorker;
}

/**
 * Test-only state reset. Forgets the cached worker + active model id so
 * the next `ensureSlmReady` call starts from a clean slate. Production
 * code should never need this.
 *
 * @internal
 */
export function __resetSlmAdapterForTests(): void {
  _worker = null;
  _activeModelId = null;
}

/**
 * Idempotently bring the SLM worker into a ready state for the requested
 * model.
 *
 * Steps:
 *   1. Resolve the descriptor (default-or-by-id). Throws if the id is unknown.
 *   2. If a worker is already running for this model, fast-path return.
 *   3. Otherwise: load bytes (cache or network), create / reuse the worker,
 *      and call `worker.init(model, bytes)`.
 *
 * The function returns the resolved model id so the caller can confirm
 * which model is now active (e.g. for telemetry / UI badges).
 */
export async function ensureSlmReady(
  opts: SLMAdapterOptions = {},
): Promise<{ modelId: string }> {
  const model: ModelDescriptor | undefined = opts.modelId
    ? getModelById(opts.modelId)
    : getDefaultModel();
  if (!model) {
    throw new Error(`Unknown SLM model: ${opts.modelId ?? '(default)'}`);
  }

  if (_worker && _activeModelId === model.id) {
    return { modelId: model.id };
  }

  // Either no worker yet, or worker is bound to a different model. We
  // load the new bytes first (so we don't tear down a working session
  // before we have something to replace it with) and then re-init.
  const bytes = await loadModel(model, { onProgress: opts.onProgress });

  if (!_worker) {
    _worker = _createWorker();
  }

  await _worker.init(model, bytes);
  _activeModelId = model.id;
  return { modelId: model.id };
}

/**
 * Run a single SLM inference call.
 *
 * Ensures the worker is ready (loading the requested model on demand)
 * and then delegates to `worker.generate`. The return type is exactly
 * what the worker reports — this facade adds no transformation.
 *
 * Mirror of `geminiAdapter.generate` semantics: throws on failure,
 * resolves with a populated `SLMResponse` on success.
 */
export async function complete(
  query: SLMQuery,
  opts?: SLMAdapterOptions,
): Promise<SLMResponse> {
  await ensureSlmReady(opts);
  if (!_worker) {
    // Defensive: ensureSlmReady's contract guarantees a worker on success.
    throw new Error('SLM worker not initialized');
  }
  return _worker.generate(query);
}

/**
 * Tear down the SLM worker and forget the active model.
 *
 * After this resolves, the next `complete()` / `ensureSlmReady()` call
 * will re-load the model and spin up a fresh worker. Idempotent —
 * calling on a never-initialized adapter is a no-op.
 *
 * Use this when the user signs out, when free-memory pressure is high,
 * or in tests to keep cases isolated.
 */
export async function disposeSlm(): Promise<void> {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
    _activeModelId = null;
  }
}

/**
 * Currently-loaded model id, or `null` if no model is active.
 *
 * Useful for the model-management UI (which model are we using right
 * now?) and for orchestrator telemetry.
 */
export function getActiveModelId(): string | null {
  return _activeModelId;
}
