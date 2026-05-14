/**
 * SLM Runtime — Sprint 47, Brecha C (C.9 SLM offline runtime).
 *
 * Thin, registry-aware lifecycle surface for ONNX Runtime Web with
 * WebGPU primary / WASM fallback execution providers. This is the
 * "clean room" abstraction the C.9 plan calls for, intentionally kept
 * separate from the legacy paths so we can evolve it without churning
 * the existing call sites:
 *
 *   - `slmAdapter.ts` + `worker/slmWorker.ts` — Comlink-based Phi-3 /
 *     Qwen / Gemma pipeline used by AsesorChat today.
 *   - `onnxAdapter.ts` — main-thread TinyLlama adapter for Brecha B.
 *
 * `slmRuntime.ts` is the third member of the family. It is:
 *   - Registry-aware: `loadModel(id)` resolves URL + expected SHA-256
 *     from `registry.ts`.
 *   - Integrity-first: every load runs through `slmIntegrityGuard.ts`
 *     before bytes ever reach `ort.InferenceSession.create()`. A
 *     declared expected hash that doesn't match → `SlmIntegrityError`.
 *     A `null` expected hash is allowed only because production
 *     publishing is staged (release pipeline will populate hashes on
 *     first verified download); the runtime still computes + returns
 *     the hash so observability can log it.
 *   - Backend-honest: requests `['webgpu', 'wasm']` and reports back
 *     which provider ORT actually selected, so telemetry can split
 *     latency by backend without guessing.
 *
 * What this module deliberately does NOT do:
 *   - It does NOT pick the model — the caller passes a registry id.
 *   - Sprint 54: it DOES read the IndexedDB cache (`cache/modelCache.ts`)
 *     before any network fetch. First-run downloads from HuggingFace +
 *     persists to cache; every subsequent load hits the cache and goes
 *     fully offline (the emergency-without-internet contract). The
 *     cache lookup runs the same integrity guard against the cached
 *     bytes as the network path, so a tampered/corrupted cache
 *     produces SlmIntegrityError, never a silent bad load.
 *   - It does NOT manage tokenizers — `infer()` uses a byte-level
 *     fallback when no tokenizer is provided so the runtime can be
 *     exercised end-to-end without `@huggingface/transformers`. Real
 *     BPE tokenization lives in `worker/slmWorker.ts` / `tokenizer.ts`.
 *
 * Bundle note: onnxruntime-web is ~21 MB of WASM. We import it
 * dynamically inside `loadModel()` so the cold-start path of the rest
 * of the app stays clean; the D.7 perf pass will route this through a
 * route-split chunk.
 */

import {
  cacheBundle,
  cacheModel,
  loadCachedBundle,
  loadCachedModel,
} from './cache/modelCache';
import { getModelById, listDownloadableFiles } from './registry';
import {
  SlmIntegrityError,
  assertModelIntegrity,
  computeSha256Hex,
  verifyBundleIntegrity,
} from './slmIntegrityGuard';
import type { ModelDescriptor, SLMBackend } from './types';

/**
 * Default fetch timeout for model downloads (60s). HuggingFace LFS
 * sometimes takes a while on first byte; 60s is a defensible upper
 * bound that still aborts a stalled connection.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

/**
 * A loaded model handle. Opaque to callers — they only need it as the
 * first argument to `infer()` / `release()`.
 */
export interface LoadedModel {
  /** Registry id this handle was loaded from. */
  readonly modelId: string;
  /** Resolved descriptor at load time (snapshot — registry edits won't bleed in). */
  readonly descriptor: ModelDescriptor;
  /** SHA-256 (hex) actually observed on download. Useful for telemetry. */
  readonly observedSha256: string;
  /** Backend ORT selected at session-create time. */
  readonly backend: SLMBackend;
  /** Live ONNX `InferenceSession` instance (kept opaque for callers). */
  readonly session: OnnxInferenceSessionLike;
}

/** Optional inputs for `loadModel`. */
export interface LoadModelOptions {
  /** Override the network fetch (tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Abort signal for the model download. */
  signal?: AbortSignal;
  /** Timeout in ms for the model download. Default 60s. */
  timeoutMs?: number;
  /** Override `import('onnxruntime-web')` for tests. */
  ortFactory?: () => Promise<OnnxRuntimeLike>;
  /**
   * Override the expected SHA-256 declared in the registry. Useful for
   * release-pipeline tooling that runs against a freshly published
   * model whose hash hasn't been written into the registry yet.
   */
  expectedSha256Override?: string | null;
  /**
   * Sprint 54: skip the IndexedDB cache entirely and re-fetch from
   * network. Defaults to `false` (cache-first read-through). Set true
   * to force a fresh download — useful for the release pipeline that
   * needs to recompute hashes against the live HF artifact, or when
   * the user explicitly hits "redownload" in the model-management UI.
   */
  bypassCache?: boolean;
  /**
   * Sprint 54: skip persisting the freshly downloaded bytes to the
   * cache. Defaults to `false` (every successful download is cached).
   * Set true for ephemeral pipeline runs.
   */
  skipCachePersist?: boolean;
}

/** Optional inputs for `infer`. */
export interface InferOptions {
  /** Hard cap on generated tokens. Default 64. */
  maxTokens?: number;
  /**
   * Tokenizer hook. Callers who need real BPE tokenization should pass
   * their own (e.g. `@huggingface/transformers` `AutoTokenizer`). When
   * omitted, the runtime uses a byte-level fallback that produces
   * reversible-but-not-semantic encodings — fine for smoke tests and
   * runtime contract verification, NOT fine for production AsesorChat.
   */
  tokenizer?: SlmTokenizerLike;
}

/**
 * Minimal tokenizer surface accepted by `infer()`. Compatible with the
 * `encode(text) → number[]` / `decode(ids) → string` shape exposed by
 * `@huggingface/transformers` `AutoTokenizer` instances.
 */
export interface SlmTokenizerLike {
  encode(text: string): number[] | { input_ids: number[] };
  decode(ids: number[], opts?: { skip_special_tokens?: boolean }): string;
}

/**
 * Tiny structural slice of `onnxruntime-web` we depend on. Declared
 * locally so tests can supply a fake without dragging in the full
 * upstream type surface.
 */
/**
 * ORT-web (since 1.17) accepts external data via `externalData` option
 * for split models like Phi-3 ONNX-web where the `.onnx` file references
 * a sibling `.onnx_data` blob. Shape mirrors the upstream `FileLike`
 * structure: each entry has a binary payload + the path the model file
 * references (NOT the URL — just the relative filename the ONNX graph
 * uses).
 */
export interface OnnxExternalDataFile {
  data: ArrayBuffer | Uint8Array;
  path: string;
}

export interface OnnxRuntimeLike {
  InferenceSession: {
    create(
      buffer: ArrayBuffer | Uint8Array,
      options?: {
        executionProviders?: ReadonlyArray<string>;
        externalData?: ReadonlyArray<OnnxExternalDataFile>;
      },
    ): Promise<OnnxInferenceSessionLike>;
  };
  Tensor?: new (
    type: string,
    data: BigInt64Array | Float32Array | Int32Array | number[],
    dims: ReadonlyArray<number>,
  ) => OnnxTensorLike;
}

export interface OnnxInferenceSessionLike {
  readonly inputNames?: ReadonlyArray<string>;
  readonly outputNames?: ReadonlyArray<string>;
  /**
   * Non-public-but-stable backend signal — ORT-web exposes the chosen
   * execution provider via `handler._executionProviders` on web. We
   * read it best-effort to populate `LoadedModel.backend`.
   */
  readonly handler?: {
    readonly _executionProviders?: ReadonlyArray<string | { name?: string }>;
  };
  run?(
    feeds: Record<string, OnnxTensorLike>,
  ): Promise<Record<string, OnnxTensorLike>>;
  release?(): Promise<void>;
}

export interface OnnxTensorLike {
  readonly data: ArrayLike<number> | Float32Array | BigInt64Array | Int32Array;
  readonly dims: ReadonlyArray<number>;
}

/**
 * Public runtime surface. Three methods, all async-safe:
 *   - `loadModel(id)` — resolve registry entry → fetch → integrity →
 *     ONNX session. Throws `SlmIntegrityError` on hash mismatch.
 *   - `infer(model, prompt)` — single forward pass with greedy
 *     argmax. Returns the decoded text.
 *   - `release(model)` — free the ONNX session. iOS Safari is
 *     particularly sensitive to leaked WASM memory; we always call
 *     `session.release()` if available.
 */
export interface SlmRuntime {
  loadModel(id: string, opts?: LoadModelOptions): Promise<LoadedModel>;
  infer(model: LoadedModel, prompt: string, opts?: InferOptions): Promise<string>;
  release(model: LoadedModel): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────
// Default implementation
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a `SlmRuntime` instance. Each call returns a fresh, stateless
 * runtime — sessions live inside the `LoadedModel` handles, not in the
 * runtime object, so multiple runtimes can coexist without colliding
 * on session state.
 */
export function createSlmRuntime(): SlmRuntime {
  return {
    async loadModel(id, opts = {}) {
      const descriptor = getModelById(id);
      if (!descriptor) {
        throw new Error(`SlmRuntime: unknown model id '${id}'.`);
      }

      // Sprint 54 SLM real: when a descriptor declares companionFiles
      // (split ONNX-web models like Phi-3 with .onnx + .onnx_data), we
      // fan out the download + integrity check across the whole bundle
      // and pass the companions to ORT as `externalData`. Models
      // without companions take the simple single-file path below for
      // backwards compatibility.
      if (descriptor.companionFiles && descriptor.companionFiles.length > 0) {
        return loadBundledModel(descriptor, opts);
      }

      // Sprint 54 — cache-first read-through. If the cache has bytes,
      // use them; integrity is re-verified against the cached payload
      // so a tampered/corrupted cache fails closed exactly like a
      // network mismatch would. Only on miss do we hit HuggingFace.
      //
      // Sprint 54 ext: pre-packaged path takes precedence even over
      // the cache because it's known-good bytes shipped with the app
      // bundle. Same-origin fetch → no CORS, instant on subsequent
      // launches via service worker precache. If pre-packaged is set
      // and the cache is cold, we fetch from `/models/...` (NOT from
      // HuggingFace) and treat it as a "downloaded" payload that's
      // then persisted to IndexedDB. Failures fall back to network.
      let bytes: Uint8Array;
      let cacheHit = false;
      if (!opts.bypassCache) {
        const cached = await loadCachedModel(descriptor.id).catch(
          () => null,
        );
        if (cached) {
          bytes = new Uint8Array(cached);
          cacheHit = true;
        } else if (descriptor.prePackagedPath) {
          // Try pre-packaged first. If the asset is missing (e.g. dev
          // build without the model bundled) fall through to HF.
          const prePacked = await tryFetchPrePackaged(
            descriptor.prePackagedPath,
            opts,
          );
          if (prePacked) {
            bytes = prePacked;
          } else {
            const url = resolveWeightUrl(descriptor);
            bytes = await fetchWithTimeout(url, opts);
          }
        } else {
          const url = resolveWeightUrl(descriptor);
          bytes = await fetchWithTimeout(url, opts);
        }
      } else {
        const url = resolveWeightUrl(descriptor);
        bytes = await fetchWithTimeout(url, opts);
      }

      // Strict integrity check: if the descriptor declares an expected
      // hash (or the caller overrode it), we MUST match it. A `null`
      // expectation is a non-no-op: we still compute the observed hash
      // so observability can persist it.
      const expected =
        opts.expectedSha256Override !== undefined
          ? opts.expectedSha256Override
          : descriptor.expectedSha256 ?? null;

      const observedSha256 = await assertModelIntegrity(
        bytes,
        expected,
        descriptor.id,
      );

      // Persist fresh downloads (post-integrity) so the next launch is
      // fully offline. Cache hits skip this — they're already there.
      if (!cacheHit && !opts.skipCachePersist) {
        await cacheModel(
          descriptor.id,
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        ).catch(() => {
          // Cache persistence failure is non-fatal — the model still
          // loads this session; next launch will just have to re-fetch.
        });
      }

      const ort = await (opts.ortFactory ?? defaultOrtFactory)();
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['webgpu', 'wasm'],
      });

      const backend = detectBackend(session);

      return {
        modelId: descriptor.id,
        descriptor,
        observedSha256,
        backend,
        session,
      };
    },

    async infer(model, prompt, opts = {}) {
      if (!model.session.run || typeof model.session.run !== 'function') {
        throw new Error(
          `SlmRuntime.infer: session for '${model.modelId}' has no run() method.`,
        );
      }
      const maxTokens = Math.max(1, Math.floor(opts.maxTokens ?? 64));

      const tokenizer = opts.tokenizer ?? createByteLevelTokenizer();
      const encoded = tokenizer.encode(prompt);
      const promptIds = Array.isArray(encoded)
        ? encoded.map(Number)
        : encoded.input_ids.map(Number);

      if (promptIds.length === 0) {
        return '';
      }

      const inputName = model.session.inputNames?.[0] ?? 'input_ids';
      const outputName = model.session.outputNames?.[0] ?? 'logits';

      const ortLike = await defaultOrtFactory().catch(() => null);
      // If ORT didn't expose a Tensor constructor (tests don't always
      // mock it), refuse to run rather than fabricate logits silently.
      const TensorCtor = ortLike?.Tensor;
      if (!TensorCtor) {
        throw new Error(
          'SlmRuntime.infer: onnxruntime-web Tensor constructor unavailable.',
        );
      }

      const currentIds = promptIds.slice();
      const generated: number[] = [];

      for (let step = 0; step < maxTokens; step++) {
        const data = BigInt64Array.from(currentIds.map((n) => BigInt(n)));
        const tensor = new TensorCtor('int64', data, [1, currentIds.length]);

        // eslint-disable-next-line no-await-in-loop
        const out = await model.session.run({ [inputName]: tensor });
        const logits = out[outputName];
        if (!logits) break;

        const dims = logits.dims;
        const flat = logits.data as ArrayLike<number>;
        if (!flat || dims.length < 2) break;

        const vocabSize = dims[dims.length - 1];
        const seqLen = dims.length === 3 ? dims[1] : 1;
        const offset = (seqLen - 1) * vocabSize;

        let bestId = 0;
        let bestScore = Number(flat[offset]);
        for (let v = 1; v < vocabSize; v++) {
          const s = Number(flat[offset + v]);
          if (s > bestScore) {
            bestScore = s;
            bestId = v;
          }
        }

        // EOS id 2 — matches the Llama / Phi-3 / Gemma tokenizer family.
        if (bestId === 2) break;
        generated.push(bestId);
        currentIds.push(bestId);
      }

      try {
        return tokenizer.decode(generated, { skip_special_tokens: true });
      } catch {
        return tokenizer.decode(generated);
      }
    },

    async release(model) {
      // iOS Safari is the canary here — without an explicit release()
      // the WASM heap can hit the 4 GB hard cap after a couple of model
      // swaps. Always call when available, swallow errors (we're
      // tearing down anyway).
      const session = model.session;
      if (session && typeof session.release === 'function') {
        try {
          await session.release();
        } catch {
          // best-effort — tearing down
        }
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Resolve the canonical HuggingFace weight URL from a descriptor.
 * If `descriptor.weightFilename` is present, build the HF
 * `/resolve/main/<file>` URL; otherwise return `descriptor.url` as-is.
 *
 * Kept local (rather than imported from `slmIntegrityCheck.ts`) so the
 * runtime has no coupling to the legacy integrity-check policy layer.
 */
export function resolveWeightUrl(descriptor: ModelDescriptor): string {
  if (!descriptor.weightFilename) return descriptor.url;
  const base = descriptor.url.replace(/\/$/, '');
  if (base.includes('/resolve/')) return base;
  return `${base}/resolve/main/${descriptor.weightFilename}`;
}

/**
 * Sprint 54 ext: try the pre-packaged asset path. Returns `null` if
 * the asset is not present (404 / network error), letting the caller
 * fall back to HuggingFace. This is the "shipped inside the app
 * bundle" path — same-origin, no CORS, eligible for Workbox precache.
 */
async function tryFetchPrePackaged(
  path: string,
  opts: LoadModelOptions,
): Promise<Uint8Array | null> {
  try {
    return await fetchWithTimeout(path, opts);
  } catch {
    return null;
  }
}

/**
 * Sprint 54 ext: try the pre-packaged bundle (principal + companions).
 * The principal lives at `principalPath`; companions live in the same
 * directory and are addressed by their relative filenames. Returns
 * `null` if ANY file is missing — partial pre-packaged bundles are
 * NOT loadable (the ONNX graph references companions by exact path).
 */
async function tryFetchPrePackagedBundle(
  principalPath: string,
  companionFilenames: ReadonlyArray<string>,
  opts: LoadModelOptions,
): Promise<Uint8Array[] | null> {
  const principal = await tryFetchPrePackaged(principalPath, opts);
  if (!principal) return null;
  // Derive the base directory from the principal path so companions
  // resolve to siblings (e.g. `/models/phi/model.onnx` →
  // `/models/phi/model.onnx_data`).
  const lastSlash = principalPath.lastIndexOf('/');
  const baseDir =
    lastSlash >= 0 ? principalPath.slice(0, lastSlash + 1) : '/';
  const companions: Uint8Array[] = [];
  for (const filename of companionFilenames) {
    // Companion filenames may already contain a path prefix (e.g.
    // `onnx/model_q4.onnx_data`); take only the basename so it sits
    // next to the principal in the pre-packaged directory.
    const basename = filename.includes('/')
      ? filename.slice(filename.lastIndexOf('/') + 1)
      : filename;
    const c = await tryFetchPrePackaged(`${baseDir}${basename}`, opts);
    if (!c) return null;
    companions.push(c);
  }
  return [principal, ...companions];
}

async function fetchWithTimeout(
  url: string,
  opts: LoadModelOptions,
): Promise<Uint8Array> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchImpl =
    opts.fetchImpl ??
    ((u: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(u, init));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Honour the caller's external abort signal too.
  const external = opts.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort);
  }

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(
        `SlmRuntime: fetch failed for ${url} (HTTP ${res.status} ${res.statusText}).`,
      );
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Sprint 54: split-model load path. Resolves descriptor → fan-out
 * fetch (principal + companions) → bundle-wide integrity check →
 * ORT session with `externalData` populated. Throws
 * `SlmIntegrityError` on the first mismatch.
 *
 * The companion files are exposed to ORT under the SAME filename the
 * descriptor declares (e.g. `onnx/model_q4.onnx_data`) because the
 * principal `.onnx` graph references that exact relative path
 * internally.
 */
async function loadBundledModel(
  descriptor: ModelDescriptor,
  opts: LoadModelOptions,
): Promise<LoadedModel> {
  const files = listDownloadableFiles(descriptor);
  const principalFilename = files[0]!.filename;
  const companionFilenames = files.slice(1).map((f) => f.filename);

  // Sprint 54 — cache-first read-through for the whole bundle. If ANY
  // companion is missing from the cache, `loadCachedBundle` returns
  // null and we fall through to the network path: partial bundles
  // can't be loaded because the principal `.onnx` graph references
  // the companion `.onnx_data` by relative path.
  //
  // Sprint 54 ext: pre-packaged bundle. If the descriptor declares a
  // `prePackagedPath`, the principal lives at that path and companions
  // live alongside (same directory, by filename). When ALL files are
  // present locally we skip HuggingFace entirely; otherwise fall back.
  let payloads: Uint8Array[];
  let cacheHit = false;
  if (!opts.bypassCache) {
    const cached = await loadCachedBundle(
      descriptor.id,
      principalFilename,
      companionFilenames,
    ).catch(() => null);
    if (cached) {
      payloads = cached.map((f) => f.payload);
      cacheHit = true;
    } else if (descriptor.prePackagedPath) {
      const prePackedBundle = await tryFetchPrePackagedBundle(
        descriptor.prePackagedPath,
        companionFilenames,
        opts,
      );
      if (prePackedBundle) {
        payloads = prePackedBundle;
      } else {
        payloads = await Promise.all(
          files.map((f) => fetchWithTimeout(f.url, opts)),
        );
      }
    } else {
      payloads = await Promise.all(
        files.map((f) => fetchWithTimeout(f.url, opts)),
      );
    }
  } else {
    payloads = await Promise.all(
      files.map((f) => fetchWithTimeout(f.url, opts)),
    );
  }

  // Run bundle-wide integrity check. If the descriptor declares
  // expected hashes (verified at release time), every file MUST match
  // before any bytes hit ORT. Override applies to the principal file
  // only — companions stay registry-pinned.
  const filesToVerify = files.map((f, idx) => ({
    filename: f.filename,
    payload: payloads[idx]!,
    expectedSha256:
      idx === 0 && opts.expectedSha256Override !== undefined
        ? opts.expectedSha256Override
        : f.expectedSha256,
  }));

  const verification = await verifyBundleIntegrity(
    descriptor.id,
    filesToVerify,
  );

  // Persist freshly-downloaded bundle (post-integrity) so subsequent
  // launches are fully offline. Cache hits skip this.
  if (!cacheHit && !opts.skipCachePersist) {
    await cacheBundle(
      descriptor.id,
      files.map((f, idx) => ({
        filename: f.filename,
        payload: payloads[idx]!,
      })),
    ).catch(() => {
      // Best-effort: cache write failure is non-fatal.
    });
  }

  // The principal file is always at index 0 (registry contract).
  const principalBytes = payloads[0]!;
  const externalData: OnnxExternalDataFile[] = payloads
    .slice(1)
    .map((data, idx) => ({
      data,
      // The path here MUST match what the ONNX graph references —
      // i.e. the filename inside the repo (e.g. `onnx/model_q4.onnx_data`).
      path: files[idx + 1]!.filename,
    }));

  const ort = await (opts.ortFactory ?? defaultOrtFactory)();
  const session = await ort.InferenceSession.create(principalBytes, {
    executionProviders: ['webgpu', 'wasm'],
    externalData,
  });

  const backend = detectBackend(session);

  return {
    modelId: descriptor.id,
    descriptor,
    observedSha256: verification.files[0]!.computedSha256,
    backend,
    session,
  };
}

async function defaultOrtFactory(): Promise<OnnxRuntimeLike> {
  // Dynamic import so the ~21MB WASM payload stays out of the cold
  // bundle. The D.7 perf pass will additionally route-split this.
  const mod = (await import('onnxruntime-web')) as unknown as
    | OnnxRuntimeLike
    | { default: OnnxRuntimeLike };
  return 'default' in mod && mod.default ? mod.default : (mod as OnnxRuntimeLike);
}

/**
 * Best-effort backend introspection. ORT-web stores the realized
 * execution provider list on `session.handler._executionProviders`.
 * When we can read it, return the head; otherwise fall back to
 * `'webgpu'` (the requested primary) which is also the most likely
 * provider on the modern Chrome / Edge target.
 */
function detectBackend(session: OnnxInferenceSessionLike): SLMBackend {
  try {
    const ep = session.handler?._executionProviders;
    if (Array.isArray(ep) && ep.length > 0) {
      const head = ep[0];
      const name = typeof head === 'string' ? head : head?.name;
      if (name === 'webgpu') return 'webgpu';
      if (name === 'wasm') return 'wasm-simd';
    }
  } catch {
    // ignore — best-effort
  }
  return 'webgpu';
}

/**
 * Reversible byte-level fallback tokenizer. Used by `infer()` when no
 * real tokenizer is supplied. Each character maps to its UTF-16 code
 * unit; decoding reverses that. NOT a real BPE — only suitable for
 * smoke tests and runtime-contract verification.
 */
function createByteLevelTokenizer(): SlmTokenizerLike {
  return {
    encode(text: string): number[] {
      const out: number[] = new Array(text.length);
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
      return out;
    },
    decode(ids: number[]): string {
      let out = '';
      for (const id of ids) {
        if (id === 2) break; // EOS
        if (Number.isFinite(id) && id >= 0 && id < 0x10000) {
          out += String.fromCharCode(id);
        }
      }
      return out;
    },
  };
}

// Re-export the integrity error so callers that only import from
// `slmRuntime` get the full surface for `try { ... } catch (e) { ... }`.
export { SlmIntegrityError };
export { computeSha256Hex } from './slmIntegrityGuard';
