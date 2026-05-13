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
 * Backends that can service an `SLMResponse`. The first two cover the
 * on-device runtime (WebGPU preferred, wasm-simd as the universal
 * fallback). `'gemini'` is added in T-1.4.1 so the orchestrator can
 * surface server-side Gemini answers through the same `SLMResponse`
 * shape — call sites stay backend-agnostic but telemetry / debug UI
 * can still distinguish online vs. on-device traffic.
 */
export type SLMBackend = 'webgpu' | 'wasm-simd' | 'gemini';

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
  /**
   * Optional HuggingFace Hub repo id (e.g. `microsoft/Phi-3-mini-4k-instruct-onnx-web`)
   * used by `@huggingface/transformers` `AutoTokenizer.from_pretrained()` to
   * load the model's real BPE tokenizer in T-1.3.1. When absent, the worker
   * falls back to the naïve whitespace tokenizer from T-1.3.
   *
   * NOTE: this is a HF *repo id*, not a full URL — the transformers library
   * resolves `tokenizer.json` from the canonical Hub layout. The `url` field
   * above continues to point at the model weight bundle.
   */
  tokenizerUrl?: string;
  /** Weight container format. Pinned to onnx-int4 for Fase 1. */
  format: SLMFormat;
  /** SPDX-style license tag (or 'Gemma' for the bespoke Gemma terms). */
  license: SLMLicense;
  /** Backend the loader should attempt first when this model is selected. */
  preferredBackend: SLMBackend;
  /** Quantization scheme of the published weights. */
  quantization: SLMQuantization;
  /**
   * Sprint 39 STUB-3 close: SHA-256 expected del archivo principal de
   * pesos (post-download integrity check).
   *
   * NOTA: HuggingFace Hub usa LFS para los archivos >10MB, así que los
   * hashes cambian raramente (solo cuando el equipo re-publica). El
   * loader compara este valor contra `sha256(downloadedBytes)` antes
   * de cargar el modelo en sesión ONNX — si NO coincide, fail-closed
   * (modelo descartado, no se carga).
   *
   * Cuando se actualice el modelo upstream, este campo debe sincronizarse
   * en el mismo PR — eso fuerza al equipo a validar la versión.
   *
   * Si se deja `undefined`, el loader emite WARNING en consola y omite
   * la verificación (modo dev/staging). En production, `getDefaultModel()`
   * debe rechazar modelos sin hash si `process.env.NODE_ENV==='production'`.
   *
   * Formato: hex lowercase (64 chars), del SHA-256 del archivo
   * principal de pesos `.onnx` referenciado por `url`/repo.
   *
   * Sprint 47 C.9: el valor `null` significa explícitamente "pendiente
   * de computar en primer download verificado" (el release pipeline lo
   * persiste). `undefined` se mantiene por compat con código legacy
   * que no distingue ausencia de pendiente.
   */
  expectedSha256?: string | null;
  /**
   * Filename principal de pesos dentro del repo HF (e.g.
   * `onnx/model_q4f16.onnx`). Cuando se publica un repo onnx-web, el
   * loader resuelve este path desde el repo root para descargar el
   * peso real. Si está ausente, el loader usa heurística (busca el
   * primer .onnx en la carpeta `onnx/`).
   */
  weightFilename?: string;
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
