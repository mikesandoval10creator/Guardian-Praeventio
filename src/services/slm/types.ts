/**
 * Canonical type definitions for the SLM (Small Language Model) offline
 * inference namespace.
 *
 * This module is part of the Fase 1 SLM offline scaffolding (Sprint 20,
 * Bucket Gamma, T-1.1). It declares the shared shape used by:
 *   - the model registry (`./registry.ts`),
 *   - the future Web Worker boundary (T-1.2),
 *   - the future offline reconciliation queue (T-1.3+).
 *
 * No runtime logic, no inference, no Worker glue lives here — only types.
 */

/**
 * Backends supported by the on-device runtime. WebGPU is preferred when
 * available; wasm-simd is the universal fallback (works in any modern
 * browser, including iOS Safari before WebGPU GA).
 */
export type SLMBackend = 'webgpu' | 'wasm-simd';

/**
 * Quantization scheme for the model weights. Only int4 is supported in
 * Fase 1 — we are optimizing for the smallest viable on-device footprint.
 */
export type SLMQuantization = 'int4';

/**
 * Weight format. Pinned to ONNX with int4 weights for Fase 1; the registry
 * intentionally rejects non-ONNX entries to keep the loader path narrow.
 */
export type SLMFormat = 'onnx-int4';

/**
 * License identifiers we currently allow in the registry. Gemma's bespoke
 * license is treated separately (see registry — it lives outside the
 * permissive set and requires explicit opt-in).
 */
export type SLMLicense = 'MIT' | 'Apache-2.0' | 'Gemma';

/**
 * Static metadata describing one downloadable on-device model.
 *
 * Sizes are stored in bytes (not MB) to keep the bookkeeping unambiguous
 * and to make download-progress math direct.
 */
export interface ModelDescriptor {
  /** Stable, kebab-case identifier used as the registry key. */
  id: string;
  /** Human-readable display name shown to operators in the model picker. */
  name: string;
  /** Total payload size in bytes (sum of weights + tokenizer + config). */
  size: number;
  /** HTTPS URL for the model bundle (typically a HuggingFace Hub path). */
  url: string;
  /** Weight container format. Pinned to onnx-int4 for Fase 1. */
  format: SLMFormat;
  /** SPDX-style license tag (or 'Gemma' for the bespoke Gemma terms). */
  license: SLMLicense;
  /** Backend the loader should attempt first when this model is selected. */
  preferredBackend: SLMBackend;
  /** Quantization scheme of the published weights. */
  quantization: SLMQuantization;
}

/**
 * Input payload for a single SLM inference call.
 *
 * `maxTokens` and `temperature` are optional so the worker can apply its
 * own defaults consistent with the model's configuration.
 */
export interface SLMQuery {
  /** Raw user / system prompt text. */
  prompt: string;
  /** Hard cap on generated tokens. Worker may clamp to a model maximum. */
  maxTokens?: number;
  /** Sampling temperature. 0 = deterministic, higher = more diverse. */
  temperature?: number;
}

/**
 * Output payload returned by a successful SLM inference call.
 */
export interface SLMResponse {
  /** Generated text, decoded from output tokens. */
  text: string;
  /** Wall-clock latency of the call, measured by the worker. */
  latencyMs: number;
  /** Number of tokens actually generated (post-stop-condition). */
  tokensGenerated: number;
  /** Backend that actually serviced the call (may differ from preferred). */
  backend: SLMBackend;
}

/**
 * One entry in the offline reconciliation queue. Persisted to IndexedDB
 * while the device is offline and replayed against the server-side LLM
 * once connectivity returns, so the canonical record reflects the
 * authoritative response.
 *
 * `reconciled = false` means: SLM produced a local answer, but it has
 * not yet been validated/replaced by the server LLM.
 */
export interface OfflineQueueEntry {
  /** Stable UUID for the queue entry. */
  id: string;
  /** Original query as submitted on-device. */
  query: SLMQuery;
  /** SLM-produced response captured at the time of the offline call. */
  response: SLMResponse;
  /** UNIX epoch ms when the entry was enqueued (Date.now()). */
  createdAt: number;
  /** True once the entry has been replayed against the server LLM. */
  reconciled: boolean;
}
