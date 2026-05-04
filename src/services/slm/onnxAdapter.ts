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
}

/**
 * Minimal slice of `InferenceSession` we use. The real runtime exposes
 * far more (input/output metadata, profiler hooks, etc.) but the adapter
 * only needs `release` for memory teardown.
 */
export interface OnnxInferenceSessionLike {
  release?: () => Promise<void>;
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
   * The current build returns a placeholder string and emits one synthetic
   * token through `onToken` — the real generation loop (KV cache, sampling,
   * detokenization) lands in Ola 5c when we wire `@huggingface/transformers`
   * tokenizer + the ONNX session's `run()` method into a generation
   * scheduler. That work is intentionally separate from this scaffold so
   * the surface (class API, cache, lifecycle, feature flag) can ship and
   * be tested independently.
   *
   * Today this method DOES exercise:
   *   - `loadModel()` lazy initialization
   *   - `signal.aborted` cooperative cancellation
   *   - `onToken` streaming callback contract
   *   - `temperature` / `maxTokens` clamping defaults
   *
   * It does NOT produce model-quality text yet. Tests assert the
   * scaffold's contract (callbacks fire, abort works) rather than output
   * fidelity.
   */
  async generate(opts: SlmGenerateOptions): Promise<string> {
    if (!this.session) {
      await this.loadModel();
    }

    const maxTokens = clampPositive(opts.maxTokens, 256, 1, 4096);
    const temperature = clampRange(opts.temperature, 0.7, 0, 2);

    const promptParts: string[] = [];
    if (opts.systemPrompt && opts.systemPrompt.length > 0) {
      promptParts.push(`<|system|>\n${opts.systemPrompt}\n`);
    }
    promptParts.push(`<|user|>\n${opts.prompt}\n<|assistant|>\n`);
    const composed = promptParts.join('');

    const placeholder = buildPlaceholderResponse(composed, temperature, maxTokens);

    // Stream tokens (one per word, capped at maxTokens) so callers that
    // attached `onToken` see the contractual streaming behaviour even
    // against the placeholder generator. Real generation will replace
    // the body of this loop with sampled token ids → detokenized strings.
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
 * Deterministic placeholder until the real generation loop lands. We
 * keep this off the public API surface so the upgrade in Ola 5c is a
 * pure replacement rather than a contract change.
 */
function buildPlaceholderResponse(
  prompt: string,
  temperature: number,
  maxTokens: number,
): string {
  // Echo a short, deterministic acknowledgement so AsesorChat can
  // demonstrate the streaming + abort wiring end-to-end without yet
  // running the real model. The text is deliberately bland — it should
  // never be confused with genuine model output.
  const len = Math.min(prompt.length, 80);
  return (
    `[SLM offline placeholder · t=${temperature} · maxTokens=${maxTokens}] ` +
    `Recibido prompt de ${len} caracteres. La generación real se ` +
    `activará en Ola 5c — por ahora respondemos con un eco controlado.`
  );
}
