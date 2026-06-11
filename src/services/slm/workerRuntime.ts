/**
 * Worker-backed SLM runtime — the ONE production inference path (B14).
 *
 * Background: the audit (DEEP-B14-IA) flagged two parallel runtimes:
 *   - `worker/slmWorker.ts` — Comlink worker whose `generate()` fell
 *     back to a deterministic MOCK ("[stub:<id>] echoing prompt…").
 *     It was what `slmAdapter` actually spawned. ELIMINADO en B14.
 *   - `slmRuntime.ts` + `worker/slmRuntimeWorker.ts` — the REAL
 *     runtime (registry-aware, SHA-256 integrity, ORT WebGPU/WASM,
 *     streaming, abort) that nothing in the app spawned.
 *
 * This module makes the real one the only one: a thin main-thread
 * facade over `SlmRuntimeWorkerProxy` (shared singleton worker) whose
 * shape matches what `resilientAiAdapters.makeSlmTierAdapter` expects
 * from its `runtimeFactory` — so both AsesorChat (via `slmAdapter`)
 * and the resilient orchestrator's SLM tier run inference off the main
 * thread, with the real tokenizer, against the pre-packaged default
 * model (Qwen 0.5B).
 *
 * Honest-failure contract: nothing here fabricates text. Worker
 * unavailable (SSR / ancient browser), model unverifiable, tokenizer
 * missing — every failure REJECTS, and the caller's fallback ladder
 * (RAG corpus → honest offline message) takes over.
 */

import type {
  ProxyInferOptions,
  ProxyLoadedModel,
  SlmRuntimeWorkerProxy,
} from './worker/slmRuntimeWorkerProxy';
import { getSharedSlmWorkerProxy } from './worker/createSlmRuntimeProxyForBrowser';
import type { SLMBackend } from './types';

/** Opaque handle returned by `loadModel`. */
export interface WorkerRuntimeModel {
  readonly modelId: string;
  readonly modelHandle: string;
  readonly observedSha256: string;
  readonly backend: SLMBackend;
}

export interface WorkerRuntimeLoadOptions {
  /** Download progress hook (forwarded across the worker boundary). */
  onProgress?: (e: { loaded: number; total: number | null }) => void;
}

export interface WorkerRuntimeInferOptions {
  maxTokens?: number;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export interface WorkerRuntimeInferResult {
  text: string;
  tokensGenerated: number;
  latencyMs: number;
}

/**
 * Runtime surface shared by `slmAdapter` and the resilient SLM tier.
 * Matches `resilientAiAdapters.SlmAdapterDeps.runtimeFactory`'s
 * structural contract (loadModel / infer / inferStream / release).
 */
export interface WorkerBackedSlmRuntime {
  loadModel(
    id: string,
    opts?: WorkerRuntimeLoadOptions,
  ): Promise<WorkerRuntimeModel>;
  infer(model: WorkerRuntimeModel, prompt: string): Promise<string>;
  inferStream(
    model: WorkerRuntimeModel,
    prompt: string,
    opts?: { onToken?: (token: string) => void; signal?: AbortSignal },
  ): Promise<string>;
  /** Full result (text + latency + token count) for telemetry callers. */
  inferDetailed(
    model: WorkerRuntimeModel,
    prompt: string,
    opts?: WorkerRuntimeInferOptions,
  ): Promise<WorkerRuntimeInferResult>;
  release(model: WorkerRuntimeModel): Promise<void>;
}

/** Proxy factory seam — tests inject a fake; production uses the shared worker. */
export type ProxyProvider = () => SlmRuntimeWorkerProxy;

/**
 * Build a worker-backed runtime. By default every instance shares the
 * singleton worker (`getSharedSlmWorkerProxy`), so multiple call sites
 * (AsesorChat facade + resilient tier) reuse one ORT session instead of
 * doubling the on-device memory footprint.
 */
export function createWorkerBackedSlmRuntime(
  proxyProvider: ProxyProvider = getSharedSlmWorkerProxy,
): WorkerBackedSlmRuntime {
  return {
    async loadModel(id, opts = {}) {
      const proxy = proxyProvider();
      const loaded: ProxyLoadedModel = await proxy.loadModel(id, {
        onProgress: opts.onProgress
          ? (e) => opts.onProgress!({ loaded: e.loaded, total: e.total })
          : undefined,
      });
      return {
        modelId: loaded.modelId,
        modelHandle: loaded.modelHandle,
        observedSha256: loaded.observedSha256,
        backend: loaded.backend,
      };
    },

    async infer(model, prompt) {
      const r = await this.inferDetailed(model, prompt);
      return r.text;
    },

    async inferStream(model, prompt, opts = {}) {
      const r = await this.inferDetailed(model, prompt, {
        onToken: opts.onToken,
        signal: opts.signal,
      });
      return r.text;
    },

    async inferDetailed(model, prompt, opts = {}) {
      const proxy = proxyProvider();
      const inferOpts: ProxyInferOptions = {
        maxTokens: opts.maxTokens,
        signal: opts.signal,
        onToken: opts.onToken
          ? (e) => opts.onToken!(e.token)
          : undefined,
      };
      const r = await proxy.infer(model.modelHandle, prompt, inferOpts);
      return {
        text: r.text,
        tokensGenerated: r.tokensGenerated,
        latencyMs: r.latencyMs,
      };
    },

    async release(model) {
      const proxy = proxyProvider();
      await proxy.release(model.modelHandle);
    },
  };
}
