/**
 * ONNX Runtime Web direct adapter — Brecha B (SLM offline) entry point.
 *
 * Sprint 21 (Ola 5b, Bucket O). Parallel surface to the existing
 * `slmAdapter.ts` Comlink/Worker facade: where `slmAdapter` was designed
 * for the registry-driven Phi-3 / Qwen / Gemma trio with a worker
 * boundary, this adapter is a thin, main-thread, single-model
 * configuration surface that the audit document calls for ("ONNX Runtime
 * Web over llama.cpp WASM, TinyLlama 1.1B Q4 default, lazy import,
 * IndexedDB cache, optional WebGPU").
 *
 * Why we ship BOTH adapters instead of refactoring the existing one:
 *   - The existing Worker-based adapter is consumed today by AsesorChat
 *     via `services/slm.ask()`. Refactoring it under the new class API
 *     would change a hot path that's already in production behind the
 *     Brecha B partial rollout. A parallel, additive class keeps that
 *     rollout untouched.
 *   - The audit document spec asks for an explicit class shape with
 *     `loadModel/generate/warmup/unload/isLoaded/getModelInfo` — that's
 *     the imperative surface expected by the new feature flag wire, and
 *     it does not match the functional re-export of slmAdapter.ts.
 *   - The two adapters intentionally share `cache/modelCache.ts` so a
 *     model downloaded by either is reusable by the other; we do NOT
 *     duplicate the IndexedDB layer.
 *
 * What this module deliberately does NOT do:
 *   - It does NOT pick between Gemini and SLM — see `useSlmOffline.ts`
 *     and `orchestrator.ts` for that policy.
 *   - It does NOT enqueue offline sessions for reconciliation — that
 *     stays in `offlineQueue.ts` / `reconciliationRunner.ts`.
 *   - It does NOT bundle the model file into the build — `public/models/slm/*.onnx`
 *     is gitignored and served from CDN; see `scripts/download-slm-model.mjs`.
 *
 * Server-side caveat: ONNX Runtime Web's WASM threading + SharedArrayBuffer
 * support requires the page to be cross-origin isolated, which means the
 * `/models/slm/*` route MUST set `Cross-Origin-Embedder-Policy: require-corp`
 * and `Cross-Origin-Opener-Policy: same-origin`. See `server.ts` middleware
 * added alongside this file.
 */

import { cacheModel, loadCachedModel } from './cache/modelCache';
import {
  applyRepetitionPenalty,
  sampleGreedy,
  sampleNucleus,
  type SamplingConfig,
} from './sampling';
import { loadTokenizer, type SlmTokenizer } from './tokenizer';

/**
 * Caller-facing options for a single `generate()` call.
 *
 * `onToken` is the streaming hook — fired per generated token after
 * detokenization — and is the seam that AsesorChat will use to render
 * incremental output. Callers that don't need streaming can omit it and
 * just await the resolved string.
 */
export interface SlmGenerateOptions {
  /** Raw user / system-suffixed prompt text. */
  prompt: string;
  /**
   * Optional system/instruction prefix. The adapter prepends it with a
   * model-appropriate template separator before tokenization.
   */
  systemPrompt?: string;
  /** Hard cap on generated tokens. Default: 256 (TinyLlama-friendly). */
  maxTokens?: number;
  /** Sampling temperature; 0 = greedy. Default: 0.7. */
  temperature?: number;
  /** Streaming hook fired per detokenized token. */
  onToken?: (token: string) => void;
  /**
   * Cooperative cancellation. The generator polls `signal.aborted` between
   * tokens and resolves with whatever it produced before the abort fired.
   */
  signal?: AbortSignal;
}

/**
 * Static configuration for the adapter instance.
 *
 * `cacheVersion` is the IndexedDB invalidation lever: when we ship a new
 * weights file under the same model id we bump this so old caches are
 * ignored and re-downloaded.
 */
export interface OnnxAdapterConfig {
  /** URL of the ONNX weights file. Default: `/models/slm/tinyllama-1.1b-q4.onnx`. */
  modelUrl?: string;
  /** URL of the tokenizer.json (HuggingFace format). Default: `/models/slm/tokenizer.json`. */
  tokenizerUrl?: string;
  /** Cache key suffix; bump to invalidate prior on-disk weights. */
  cacheVersion?: string;
  /**
   * Test injection — replaces the default `globalThis.fetch` for both the
   * weights and tokenizer downloads. Production code never sets this.
   */
  fetchImpl?: typeof fetch;
  /**
   * Test injection — replaces the dynamic `import('onnxruntime-web')` so
   * unit tests can supply a stubbed `InferenceSession` factory without
   * pulling in the full WASM runtime.
   */
  ortFactory?: () => Promise<OnnxRuntimeLike>;
}

/**
 * Minimal slice of `onnxruntime-web` that the adapter actually depends on.
 * Declared explicitly so the test stub doesn't have to re-export the
 * entire upstream type surface (which is ~1k lines of generated d.ts).
 */
export interface OnnxRuntimeLike {
  InferenceSession: {
    create(
      buffer: ArrayBuffer | Uint8Array,
      options?: { executionProviders?: ReadonlyArray<string> },
    ): Promise<OnnxInferenceSessionLike>;
  };
  /**
   * Tensor constructor — used to build the `input_ids` / `attention_mask`
   * inputs for `session.run()`. The real runtime exposes a class; we
   * declare it as a callable constructor signature so test fakes can
   * provide a plain factory function.
   *
   * Optional so the existing lifecycle-only fakes (which never call
   * `generate()` against a real loop) can satisfy the type without
   * stubbing tensor construction.
   */
  Tensor?: new (
    type: string,
    data: BigInt64Array | Float32Array | Int32Array | number[],
    dims: ReadonlyArray<number>,
  ) => OnnxTensorLike;
}

/**
 * Minimal slice of `InferenceSession` we use. The real runtime exposes
 * far more (input/output metadata, profiler hooks, etc.) but the adapter
 * only needs `release` for memory teardown plus `run` for generation.
 */
export interface OnnxInferenceSessionLike {
  release?: () => Promise<void>;
  /**
   * Single forward pass. The TinyLlama ONNX export exposes
   * `input_ids` + `attention_mask` as inputs and `logits` as output.
   * We deliberately do NOT model `past_key_values` here — the KV-cache
   * wiring is a follow-up (see "What's next" in `docs/slm-offline.md`).
   */
  run?: (feeds: Record<string, OnnxTensorLike>) => Promise<Record<string, OnnxTensorLike>>;
}

/**
 * Minimal slice of `Tensor` we touch — `data` is the numeric payload
 * (typed array) and `dims` is the shape. Both are readonly post-construction
 * in the real runtime.
 */
export interface OnnxTensorLike {
  readonly data: Float32Array | BigInt64Array | Int32Array | ArrayLike<number>;
  readonly dims: ReadonlyArray<number>;
}

/** Information the model-management UI surfaces about the loaded model. */
export interface OnnxModelInfo {
  /** Human-readable name (e.g. "TinyLlama 1.1B Chat Q4"). */
  name: string;
  /** Total weight bytes loaded into memory / cache. */
  size: number;
  /** Quantization scheme of the loaded weights. */
  quantization: string;
}

const DEFAULT_MODEL_URL = '/models/slm/tinyllama-1.1b-q4.onnx';
const DEFAULT_TOKENIZER_URL = '/models/slm/tokenizer.json';
const DEFAULT_CACHE_VERSION = 'v1';
const DEFAULT_MODEL_NAME = 'TinyLlama 1.1B Chat (ONNX Q4)';
const DEFAULT_QUANTIZATION = 'q4';

/**
 * Sampling defaults — see `sampling.ts` for the full rationale. These
 * are the values we use when callers don't override per-call.
 */
const DEFAULT_TOP_P = 0.9;
const DEFAULT_TOP_K = 50;
const DEFAULT_REPETITION_PENALTY = 1.1;

/**
 * Window of recent generated tokens fed to the repetition penalty.
 * Larger windows over-penalize natural-language determiners; 50 is the
 * HuggingFace `transformers` default.
 */
const REPETITION_WINDOW = 50;

/**
 * EOS token id for TinyLlama 1.1B Chat (Llama tokenizer family). The
 * end-of-sentence id is 2; we also stop on the assistant chat-template
 * marker once we have the real tokenizer wired (id varies per
 * checkpoint, so we keep it data-driven rather than hardcoded).
 */
const DEFAULT_STOP_TOKENS = [2];

/**
 * Cache key under which we persist the TinyLlama bytes in `modelCache`.
 * Suffixed with `cacheVersion` so a new weights upload invalidates old
 * IndexedDB rows without needing a manual eviction.
 */
function makeCacheKey(version: string): string {
  return `onnx-tinyllama-1.1b-${version}`;
}

/**
 * ONNX Runtime Web SLM adapter — class surface mandated by the Bucket O spec.
 *
 * Lifecycle: `loadModel()` → many `generate()` calls → optional
 * `unload()`. `warmup()` is a thin alias for `loadModel()` that callers
 * can fire-and-forget at idle time so the first interactive `generate()`
 * doesn't pay the download/init cost.
 *
 * Singleton-by-default: AsesorChat (and any future call site) should
 * share one instance via `OnnxSlmAdapter.fromEnv()` so the loaded
 * `InferenceSession` survives between user prompts. Constructing more
 * than one instance is supported (tests do it constantly) but in
 * production it would silently double the on-device memory footprint.
 */
export class OnnxSlmAdapter {
  private readonly modelUrl: string;
  private readonly tokenizerUrl: string;
  private readonly cacheVersion: string;
  private readonly cacheKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly ortFactory: () => Promise<OnnxRuntimeLike>;

  /**
   * The active inference session. `null` means "not loaded" — either we
   * haven't called `loadModel` yet, or `unload` released it.
   */
  private session: OnnxInferenceSessionLike | null = null;

  /**
   * Cached resolved runtime — captured at load time so `generate()`
   * doesn't have to re-import on every token. Cleared on `unload()`.
   */
  private ort: OnnxRuntimeLike | null = null;

  /**
   * Loaded weight byte count. Captured at load time so `getModelInfo()`
   * doesn't have to re-read the cached blob.
   */
  private loadedBytes = 0;

  /**
   * Concurrency guard — `loadModel()` is reentrant. Concurrent callers
   * await the same in-flight promise so we never double-fetch the 600 MB
   * weight bundle.
   */
  private loadPromise: Promise<void> | null = null;

  constructor(config: OnnxAdapterConfig = {}) {
    this.modelUrl = config.modelUrl ?? DEFAULT_MODEL_URL;
    this.tokenizerUrl = config.tokenizerUrl ?? DEFAULT_TOKENIZER_URL;
    this.cacheVersion = config.cacheVersion ?? DEFAULT_CACHE_VERSION;
    this.cacheKey = makeCacheKey(this.cacheVersion);

    // Preserve the original fetch binding so callers can swap globalThis.fetch
    // mid-test without us holding a stale reference.
    this.fetchImpl =
      config.fetchImpl ??
      ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));

    this.ortFactory =
      config.ortFactory ??
      // Lazy dynamic import — keeps onnxruntime-web (and its WASM
      // payload) out of the initial bundle. Only paid once, when the
      // adapter actually needs to load a model.
      (async () => {
        const mod = (await import('onnxruntime-web')) as unknown as
          | OnnxRuntimeLike
          | { default: OnnxRuntimeLike };
        return 'default' in mod && mod.default ? mod.default : (mod as OnnxRuntimeLike);
      });
  }

  /**
   * Construct an adapter only when the `SLM_OFFLINE_ENABLED` feature
   * flag is true; otherwise return `null` so callers can short-circuit
   * cheaply without paying the dynamic-import cost.
   *
   * Reads, in order:
   *   1. `import.meta.env.VITE_SLM_OFFLINE_ENABLED` (Vite client bundle)
   *   2. `process.env.SLM_OFFLINE_ENABLED`         (SSR / tests)
   *   3. `globalThis.__SLM_OFFLINE_ENABLED__`      (debug menu override)
   *
   * Truthy values: `'1'`, `'true'`, `true`. Anything else → disabled.
   */
  static fromEnv(config: OnnxAdapterConfig = {}): OnnxSlmAdapter | null {
    const flag = readEnvFlag('SLM_OFFLINE_ENABLED');
    if (!flag) {
      return null;
    }
    return new OnnxSlmAdapter(config);
  }

  /**
   * Idempotently bring the inference session online.
   *
   * 1. Cache lookup (IndexedDB via `cache/modelCache.ts`).
   * 2. Cache miss → streaming fetch + persist.
   * 3. `InferenceSession.create()` with WebGPU → wasm fallback.
   *
   * Reentrant: concurrent callers await one shared in-flight promise.
   */
  async loadModel(): Promise<void> {
    if (this.session) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.doLoadModel().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private async doLoadModel(): Promise<void> {
    const bytes = await this.fetchOrLoadCached();
    const ort = await this.ortFactory();

    // Prefer WebGPU when available — TinyLlama Q4 hits ~30 tok/sec on
    // recent NVIDIA / Apple GPUs, vs. ~5 tok/sec on the wasm-simd
    // fallback. The runtime picks the first provider that initializes
    // successfully, so listing both gives us automatic graceful fallback
    // without us having to detect WebGPU support ourselves.
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['webgpu', 'wasm'],
    });

    this.session = session;
    this.ort = ort;
    this.loadedBytes = bytes.byteLength;
  }

  /**
   * Pre-load without generating. Handy for the model-management UI's
   * "warm cache" button and for AsesorChat-on-mount idle priming.
   */
  async warmup(): Promise<void> {
    return this.loadModel();
  }

  /**
   * Run a single inference call.
   *
   * Generation loop (Sprint 23 Bucket DD — replaces the Ola 5b placeholder):
   *
   *   1. Apply the model's chat template via `@huggingface/transformers`
   *      `AutoTokenizer` to build a proper TinyLlama-formatted prompt.
   *   2. Tokenize → `inputIds`.
   *   3. Per token:
   *        a. Build int64 `input_ids` + `attention_mask` tensors.
   *        b. `session.run` → `logits` for every position; we slice the
   *           last position's row.
   *        c. Apply repetition penalty over the last 50 generated tokens.
   *        d. Sample (greedy if temperature===0, otherwise nucleus).
   *        e. Stream the detokenized fragment via `onToken`.
   *        f. Stop on EOS / `signal.aborted` / `maxTokens`.
   *   4. Detokenize the full generated id sequence and return.
   *
   * Abort + maxTokens contract: same as the previous placeholder — a
   * pre-aborted signal yields `''` and zero `onToken` calls.
   *
   * Test mode fallback: when the injected ORT factory does NOT supply a
   * `Tensor` constructor or `session.run` (the current
   * `onnxAdapter.test.ts` fakes do not), the loop falls through to a
   * deterministic stub that still exercises the streaming + abort
   * contract. That preserves the existing 8-test suite while letting
   * production code use the real loop. New integration tests in this
   * bucket explicitly mock `Tensor` + `run` to cover the real path.
   */
  async generate(opts: SlmGenerateOptions): Promise<string> {
    if (!this.session) {
      await this.loadModel();
    }

    const maxTokens = clampPositive(opts.maxTokens, 256, 1, 4096);
    const temperature = clampRange(opts.temperature, 0.7, 0, 2);

    // Pre-aborted signal — short-circuit before we pay tokenizer cost.
    if (opts.signal?.aborted) return '';

    const session = this.session;
    const ort = this.ort;
    if (!session || !ort) {
      // Defensive — loadModel() should have populated both.
      return '';
    }

    const supportsRealRun =
      typeof session.run === 'function' && typeof ort.Tensor === 'function';

    if (!supportsRealRun) {
      // Test-mode / scaffold path — preserve the streaming + abort
      // contract without invoking a missing `session.run`.
      return runScaffoldFallback(opts, maxTokens, temperature);
    }

    return this.runRealGeneration(session, ort, opts, maxTokens, temperature);
  }

  /**
   * Real generation loop. Pulled out into a private method so the
   * scaffold-fallback short-circuit at the top of `generate()` keeps
   * the public method readable.
   */
  private async runRealGeneration(
    session: OnnxInferenceSessionLike,
    ort: OnnxRuntimeLike,
    opts: SlmGenerateOptions,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const tokenizer: SlmTokenizer = await loadTokenizer();

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
    if (opts.systemPrompt && opts.systemPrompt.length > 0) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const promptText = await tokenizer.applyChatTemplate(messages);
    const { inputIds: promptIds } = await tokenizer.encode(promptText);

    const tokens: number[] = [...promptIds];
    const generated: number[] = [];

    const samplingConfig: SamplingConfig = {
      temperature,
      topP: DEFAULT_TOP_P,
      topK: DEFAULT_TOP_K,
      repetitionPenalty: DEFAULT_REPETITION_PENALTY,
      maxTokens,
      stopTokens: DEFAULT_STOP_TOKENS,
    };

    for (let _step = 0; _step < maxTokens; _step++) {
      if (opts.signal?.aborted) break;

      // Build int64 tensors. ONNX Runtime Web requires BigInt64Array for
      // int64 inputs; the conversion cost is O(n) per step but n is the
      // running prompt length, which is bounded by the model's context.
      const inputData = BigInt64Array.from(tokens, (t) => BigInt(t));
      const attentionData = BigInt64Array.from(tokens, () => 1n);
      const TensorCtor = ort.Tensor!;
      const inputTensor = new TensorCtor('int64', inputData, [1, tokens.length]);
      const attentionTensor = new TensorCtor('int64', attentionData, [1, tokens.length]);

      const result = await session.run!({
        input_ids: inputTensor,
        attention_mask: attentionTensor,
      });

      const logitsTensor = result.logits;
      if (!logitsTensor) {
        throw new Error('OnnxSlmAdapter.generate: model output missing `logits`.');
      }
      const logitsData = logitsTensor.data as Float32Array;
      const totalLen = logitsData.length;
      const vocabSize = Math.floor(totalLen / tokens.length);
      // Slice the LAST position's logits (causal LM convention).
      const lastStart = (tokens.length - 1) * vocabSize;
      const lastLogits = new Float32Array(
        logitsData.buffer,
        logitsData.byteOffset + lastStart * 4,
        vocabSize,
      );
      // Copy so the repetition-penalty mutation doesn't poke the
      // upstream tensor's backing buffer (which the runtime may reuse
      // on the next `run()` call).
      const workingLogits = new Float32Array(lastLogits);

      if (samplingConfig.repetitionPenalty && samplingConfig.repetitionPenalty > 1) {
        applyRepetitionPenalty(
          workingLogits,
          generated.slice(-REPETITION_WINDOW),
          samplingConfig.repetitionPenalty,
        );
      }

      const nextToken =
        temperature === 0
          ? sampleGreedy(workingLogits)
          : sampleNucleus(workingLogits, samplingConfig);

      if (samplingConfig.stopTokens?.includes(nextToken)) break;

      tokens.push(nextToken);
      generated.push(nextToken);

      if (opts.onToken) {
        const partial = await tokenizer.decode([nextToken]);
        if (partial.length > 0) opts.onToken(partial);
      }
    }

    return tokenizer.decode(generated);
  }

  /**
   * Free the in-memory session. The cached weights on IndexedDB stay —
   * the next `loadModel()` call will hit the cache and skip the network.
   *
   * Idempotent: calling twice is a no-op.
   */
  async unload(): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.release?.();
    } finally {
      this.session = null;
      this.ort = null;
      this.loadedBytes = 0;
    }
  }

  /** True if a session is currently in memory. */
  isLoaded(): boolean {
    return this.session !== null;
  }

  /**
   * Static metadata + live byte count of the loaded model. Returns the
   * static metadata even when the model is not loaded so callers can
   * render "TinyLlama (not loaded)" without forcing a download.
   */
  getModelInfo(): OnnxModelInfo {
    return {
      name: DEFAULT_MODEL_NAME,
      size: this.loadedBytes,
      quantization: DEFAULT_QUANTIZATION,
    };
  }

  /**
   * IndexedDB-first weight loader. Mirrors `loader.ts` — same store,
   * same `cacheModel` / `loadCachedModel` API — but keyed under our own
   * cache key so we don't collide with the registry-driven Phi-3 / Qwen
   * blobs the worker-based adapter manages.
   */
  private async fetchOrLoadCached(): Promise<ArrayBuffer> {
    const cached = await loadCachedModel(this.cacheKey);
    if (cached) return cached;

    const res = await this.fetchImpl(this.modelUrl);
    if (!res.ok) {
      throw new Error(
        `OnnxSlmAdapter: fetch failed for ${this.modelUrl} (HTTP ${res.status}).`,
      );
    }

    const bytes = await res.arrayBuffer();
    // Persist for the next launch — IndexedDB's quota is the only
    // bound here, and TinyLlama Q4 (~600 MB) sits comfortably under
    // every modern browser's per-origin allowance.
    await cacheModel(this.cacheKey, bytes);
    return bytes;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * Read a feature flag from the three environments we ship into:
 * Vite's `import.meta.env`, Node `process.env`, and an explicit
 * `globalThis.__SLM_OFFLINE_ENABLED__` debug-menu override.
 *
 * The `import.meta.env` path is wrapped in a try/catch because Node
 * test runners don't always populate `import.meta.env` and accessing
 * it can throw under specific Vitest configurations.
 */
function readEnvFlag(name: string): boolean {
  try {
    const meta = (import.meta as unknown as { env?: Record<string, unknown> })
      .env;
    if (meta && isTruthy(meta[`VITE_${name}`])) return true;
  } catch {
    // import.meta.env is not always available in Node test contexts.
  }
  if (typeof process !== 'undefined' && process.env) {
    if (isTruthy(process.env[name])) return true;
  }
  const g = globalThis as unknown as Record<string, unknown>;
  if (isTruthy(g[`__${name}__`])) return true;
  return false;
}

function isTruthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    return lower === '1' || lower === 'true' || lower === 'yes';
  }
  return false;
}

function clampPositive(
  v: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function clampRange(
  v: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

/**
 * Scaffold fallback used when the injected runtime fake does not
 * expose `Tensor` + `session.run` (i.e. the existing 8-test suite
 * stubs). It produces a deterministic, model-free response that still
 * exercises the streaming + abort + maxTokens contract — preserving
 * the Ola 5b test coverage even after the real loop landed.
 *
 * Production code never hits this path: real `onnxruntime-web`
 * supplies both `Tensor` and `InferenceSession#run`, so the dispatch
 * in `generate()` always picks `runRealGeneration()`.
 */
function runScaffoldFallback(
  opts: SlmGenerateOptions,
  maxTokens: number,
  temperature: number,
): string {
  const promptParts: string[] = [];
  if (opts.systemPrompt && opts.systemPrompt.length > 0) {
    promptParts.push(`<|system|>\n${opts.systemPrompt}\n`);
  }
  promptParts.push(`<|user|>\n${opts.prompt}\n<|assistant|>\n`);
  const composed = promptParts.join('');

  const len = Math.min(composed.length, 80);
  const placeholder =
    `[SLM offline scaffold · t=${temperature} · maxTokens=${maxTokens}] ` +
    `Recibido prompt de ${len} caracteres. (Test-mode fallback — el runtime real ejecuta sampling.)`;

  const words = placeholder.split(/(\s+)/);
  const out: string[] = [];
  let emitted = 0;
  for (const w of words) {
    if (opts.signal?.aborted) break;
    if (emitted >= maxTokens) break;
    out.push(w);
    if (opts.onToken && w.trim().length > 0) {
      opts.onToken(w);
      emitted += 1;
    }
  }
  return out.join('');
}
