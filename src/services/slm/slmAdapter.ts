/**
 * Main-thread facade for the on-device SLM.
 *
 * Originally (Fase 1 T-1.4) this wrapped the Comlink worker
 * `worker/slmWorker.ts`, whose `generate()` could fall back to a
 * deterministic MOCK response. B14 (2026-06-11) unifies the runtimes:
 * the facade now delegates to the REAL runtime worker
 * (`slmRuntime.ts` inside `worker/slmRuntimeWorker.ts`, via
 * `workerRuntime.ts`) — registry-aware loading (pre-packaged Qwen
 * default), SHA-256 integrity, real BPE tokenizer, ORT WebGPU/WASM.
 * The mock worker is GONE from the production graph; failures reject
 * honestly so callers' fallback ladders take over.
 *
 * Public surface is unchanged (`ensureSlmReady` / `complete` /
 * `disposeSlm` / `getActiveModelId`) so the orchestrator
 * (`orchestrator.ts`) and `SLMProvider` keep working as before.
 *
 * Singleton-by-design: the module holds one loaded-model handle and
 * shares the singleton runtime worker, so the ORT session survives
 * between `complete()` invocations.
 */

import { getDefaultModel, getModelById } from './registry';
import type { ModelDescriptor, SLMQuery, SLMResponse } from './types';
import {
  createWorkerBackedSlmRuntime,
  type WorkerBackedSlmRuntime,
  type WorkerRuntimeModel,
} from './workerRuntime';
import { disposeSharedSlmWorkerProxy } from './worker/createSlmRuntimeProxyForBrowser';

/**
 * Module-scoped state. The loaded-model handle is held across calls so
 * the ORT `InferenceSession` (inside the worker) survives between
 * `complete()` invocations.
 */
let _runtime: WorkerBackedSlmRuntime | null = null;
let _model: WorkerRuntimeModel | null = null;
let _activeModelId: string | null = null;

/**
 * Optional inputs accepted by `ensureSlmReady` and `complete`.
 *
 * `modelId` defaults to the registry's default model (Qwen 2.5 0.5B —
 * the pre-packaged one; B14). The `onProgress` hook fires while bytes
 * stream on first launch and is silent on cache / pre-packaged hits.
 */
export interface SLMAdapterOptions {
  /** Registry id of the model to ensure is loaded. Defaults to the registry default. */
  modelId?: string;
  /**
   * Download-progress hook. Fires while bytes are streaming on first
   * launch; never fires when the cache is warm.
   */
  onProgress?: (loaded: number, total: number | null) => void;
}

/**
 * Runtime factory seam for tests. Production uses the shared
 * worker-backed runtime (`createWorkerBackedSlmRuntime`).
 *
 * @internal
 */
let _createRuntime: () => WorkerBackedSlmRuntime = createWorkerBackedSlmRuntime;

/**
 * Test-only injection point. Replaces the runtime factory. Pass `null`
 * to restore the production factory.
 *
 * @internal
 */
export function __setRuntimeFactoryForTests(
  factory: (() => WorkerBackedSlmRuntime) | null,
): void {
  _createRuntime = factory ?? createWorkerBackedSlmRuntime;
}

/**
 * Test-only state reset. Forgets the cached runtime + active model so
 * the next `ensureSlmReady` call starts from a clean slate.
 *
 * @internal
 */
export function __resetSlmAdapterForTests(): void {
  _runtime = null;
  _model = null;
  _activeModelId = null;
}

/**
 * Idempotently bring the SLM runtime into a ready state for the
 * requested model.
 *
 * Steps:
 *   1. Resolve the descriptor (default-or-by-id). Throws if the id is
 *      unknown.
 *   2. If the model is already loaded, fast-path return.
 *   3. Otherwise delegate to the runtime worker: pre-packaged asset →
 *      IndexedDB cache → CDN, SHA-256 integrity gate, ORT session.
 *
 * Returns the resolved model id so the caller can confirm which model
 * is active (telemetry / UI badges).
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

  if (_model && _activeModelId === model.id) {
    return { modelId: model.id };
  }

  if (!_runtime) {
    _runtime = _createRuntime();
  }

  // Release a previously loaded different model before loading the new
  // one — the worker holds the heavy ORT session.
  if (_model) {
    try {
      await _runtime.release(_model);
    } catch {
      // Best-effort: a failed release must not block the new load.
    }
    _model = null;
    _activeModelId = null;
  }

  const loaded = await _runtime.loadModel(model.id, {
    onProgress: opts.onProgress
      ? (e) => opts.onProgress!(e.loaded, e.total)
      : undefined,
  });
  _model = loaded;
  _activeModelId = loaded.modelId;
  return { modelId: loaded.modelId };
}

/**
 * Run a single SLM inference call.
 *
 * Ensures the runtime is ready (loading the requested model on demand)
 * and delegates to the runtime worker. Mirror of
 * `geminiAdapter.generate` semantics: throws on failure, resolves with
 * a populated `SLMResponse` on success — there is NO mock fallback;
 * callers own the degradation ladder.
 */
export async function complete(
  query: SLMQuery,
  opts?: SLMAdapterOptions,
): Promise<SLMResponse> {
  await ensureSlmReady(opts);
  if (!_runtime || !_model) {
    // Defensive: ensureSlmReady's contract guarantees both on success.
    throw new Error('SLM runtime not initialized');
  }
  const r = await _runtime.inferDetailed(_model, query.prompt, {
    maxTokens: query.maxTokens,
  });
  return {
    text: r.text,
    latencyMs: r.latencyMs,
    tokensGenerated: r.tokensGenerated,
    backend: _model.backend,
  };
}

/**
 * Tear down the SLM runtime and forget the active model. The shared
 * runtime worker is terminated so the ORT session memory is reclaimed
 * (iOS Safari's 4 GB WASM cap is the canary).
 *
 * Idempotent — calling on a never-initialized adapter is a no-op.
 */
export async function disposeSlm(): Promise<void> {
  if (_runtime && _model) {
    try {
      await _runtime.release(_model);
    } catch {
      // Best-effort teardown.
    }
  }
  if (_runtime) {
    // Terminate the shared worker (next ensureSlmReady spawns a fresh one).
    try {
      disposeSharedSlmWorkerProxy();
    } catch {
      // Best-effort teardown.
    }
  }
  _runtime = null;
  _model = null;
  _activeModelId = null;
}

/**
 * Currently-loaded model id, or `null` if no model is active.
 */
export function getActiveModelId(): string | null {
  return _activeModelId;
}
