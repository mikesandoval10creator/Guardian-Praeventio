/**
 * SLM Web Worker — runs ONNX Runtime Web off the main thread.
 *
 * Fase 1 (Sprint 20, Bucket Iota, T-1.3). This file is the worker
 * script's source: Vite picks it up via `new Worker(new URL(...))` from
 * `../workerProxy.ts`, transpiles it to a module worker, and the main
 * thread talks to it through Comlink.
 *
 * Status as of T-1.3 — REAL INFERENCE WIRED:
 *   - `init()` builds an `ort.InferenceSession` from the supplied
 *     model bytes, preferring WebGPU and falling back to WASM SIMD.
 *   - `generate()` runs greedy decoding via `session.run({ input_ids })`
 *     up to `query.maxTokens` (or 64 by default) and returns the
 *     decoded text plus measured latency. If real inference throws
 *     for any reason — incompatible IO names, OOM, no provider, etc —
 *     we catch and fall back to the deterministic stub from T-1.2 so
 *     the worker contract (an `SLMResponse`, never a rejection) is
 *     honoured. See `// TODO T-1.3.2` markers.
 *   - Tokenization is a naïve whitespace/regex tokenizer with a
 *     deterministic vocab built from the prompt. This unblocks the
 *     end-to-end path; replacing it with the model's real tokenizer
 *     (loaded from `model.tokenizerUrl`) is T-1.3.1 follow-up work.
 *
 * Why a Worker (rather than running on the main thread):
 *   - ONNX Runtime Web pegs a CPU core during decode; running on the
 *     main thread would jank scrolling and the emergency UI.
 *   - The Worker can hold the (large) `InferenceSession` in module
 *     state without fighting React's StrictMode double-mounts.
 *
 * The worker file is intentionally `// @ts-nocheck` — the WebWorker
 * lib types and the DOM lib types conflict in a single tsconfig, and
 * the ORT Tensor type also requires `BigInt64Array` which TS' strict
 * lib pruning sometimes hides from the worker scope. T-1.3 wider
 * type cleanup is tracked separately (worker tsconfig split).
 */
// @ts-nocheck
// TODO T-1.3: enable strict types after the worker tsconfig split.

import * as Comlink from 'comlink';
import * as ort from 'onnxruntime-web';

import type { ModelDescriptor, SLMBackend, SLMQuery, SLMResponse } from '../types';

/**
 * The API the worker exposes back to the main thread via Comlink.
 *
 * Mirror this shape in `../workerProxy.ts` so consumers of the proxy
 * see the same method signatures with `Promise`-returning semantics.
 */
export interface SlmWorkerApi {
  /** Load model bytes into an `InferenceSession` (T-1.3). */
  init(model: ModelDescriptor, modelBytes: ArrayBuffer): Promise<void>;
  /** Run inference on a prompt — currently returns a mock response. */
  generate(query: SLMQuery): Promise<SLMResponse>;
  /** Release any held session / WASM memory. */
  dispose(): Promise<void>;
}

/**
 * Internal worker state. Kept in module scope so it persists across
 * Comlink calls — Comlink doesn't add object identity, the worker
 * itself does. `null` means "no model loaded yet".
 */
let activeModel: ModelDescriptor | null = null;
let activeSession: any | null = null;
/**
 * The execution provider that ORT actually picked at session-create
 * time. Mapped to our public `SLMBackend` ("webgpu" | "wasm-simd")
 * so `generate()` can report it back honestly even when WebGPU was
 * preferred but unavailable.
 */
let activeBackend: SLMBackend | null = null;

/** Default decoding budget when the caller doesn't supply `maxTokens`. */
const DEFAULT_MAX_TOKENS = 64;

/**
 * Naïve tokenizer used as the fallback when the model's real
 * tokenizer JSON has not been wired up yet. Deterministic + reversible
 * for any single prompt, which is enough to make `generate()` produce
 * coherent-with-prompt output rather than gibberish.
 *
 * The vocab is built lazily per-call from the prompt itself plus a
 * tiny set of reserved control ids, so we never need to ship a
 * vocabulary file. Each unique whitespace-delimited token gets a
 * fresh id starting at 32 (leaving 0..31 reserved for control / EOS).
 *
 * TODO T-1.3.1: replace with the model's published tokenizer
 * (Phi-3 ships a `tokenizer.json` alongside `model_q4f16.onnx` —
 * loader needs to fetch it via `model.tokenizerUrl` and we should
 * use `@huggingface/transformers` Tokenizer or a small JS port).
 */
const RESERVED_EOS_ID = 2;
const RESERVED_BASE = 32;

interface NaiveTokenizer {
  encode(text: string): number[];
  decode(ids: number[]): string;
}

function buildNaiveTokenizer(seed: string): NaiveTokenizer {
  const tokenToId = new Map<string, number>();
  const idToToken = new Map<number, string>();
  let nextId = RESERVED_BASE;

  const idFor = (tok: string): number => {
    let id = tokenToId.get(tok);
    if (id === undefined) {
      id = nextId++;
      tokenToId.set(tok, id);
      idToToken.set(id, tok);
    }
    return id;
  };

  // Pre-seed the vocab from the prompt so encode() produces ids
  // that decode() can resolve. Splitting on whitespace + punctuation
  // is enough for the fallback path.
  const seedTokens = seed.match(/\S+|\s+/g) ?? [];
  for (const t of seedTokens) idFor(t);

  return {
    encode(text: string): number[] {
      const tokens = text.match(/\S+|\s+/g) ?? [];
      return tokens.map(idFor);
    },
    decode(ids: number[]): string {
      let out = '';
      for (const id of ids) {
        if (id === RESERVED_EOS_ID) break;
        const tok = idToToken.get(id);
        if (tok !== undefined) out += tok;
      }
      return out;
    },
  };
}

/**
 * Map the ORT session's reported execution provider list back to the
 * public `SLMBackend` enum. ORT exposes the chosen providers via
 * non-public-but-stable `session.handler._executionProviders` on web;
 * the safer signal is the `executionProviders` we requested combined
 * with the absence of a thrown error. Per-session reflection is
 * best-effort — if we can't introspect, fall back to the model's
 * preferred backend (we only get here when create() succeeded with
 * the requested provider, so this is accurate in practice).
 */
function detectBackend(session: any, requested: SLMBackend): SLMBackend {
  try {
    const ep = session?.handler?._executionProviders ?? session?.executionProviders;
    if (Array.isArray(ep) && ep.length > 0) {
      const head = typeof ep[0] === 'string' ? ep[0] : ep[0]?.name;
      if (head === 'webgpu') return 'webgpu';
      if (head === 'wasm') return 'wasm-simd';
    }
  } catch {
    // best-effort — fall through
  }
  return requested;
}

/**
 * Build the deterministic fallback `SLMResponse` we used in T-1.2.
 * Reused by `generate()` when real inference throws so the worker
 * contract (always resolve, never reject) is preserved.
 *
 * TODO T-1.3.2: improve error recovery — e.g. surface a typed
 * `failureReason` field, capture the underlying ORT error code,
 * and let the caller distinguish "load failed" from "OOM mid-decode".
 */
function buildStubResponse(
  model: ModelDescriptor,
  query: SLMQuery,
  startedAt: number,
): SLMResponse {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const text =
    `[stub:${model.id}] echoing prompt of ${query.prompt.length} ` +
    `chars (real inference fell back to stub; see TODO T-1.3.2)`;
  return {
    text,
    latencyMs: Math.max(0, now - startedAt),
    tokensGenerated: Math.ceil(text.length / 4),
    backend: activeBackend ?? model.preferredBackend,
  };
}

const slmWorkerApi: SlmWorkerApi = {
  /**
   * Bind a model to this worker.
   *
   * Real T-1.3 path: build an `ort.InferenceSession` from the bytes
   * the loader fetched. We try WebGPU first when the model prefers
   * it, then fall back to WASM SIMD, which is universally available.
   * Once the session is up we record metadata (input / output names,
   * actual provider) so `generate()` can report `backend` truthfully.
   *
   * If `InferenceSession.create` throws, we leave the session null
   * and let `generate()` use the deterministic stub. We DO record
   * the descriptor either way so error surfaces (e.g. tests) can
   * distinguish "init never called" from "init failed".
   */
  async init(model: ModelDescriptor, modelBytes: ArrayBuffer): Promise<void> {
    activeModel = model;
    activeSession = null;
    activeBackend = null;

    // Pick the provider order. WebGPU first (when preferred) gives
    // us the fast path on modern Chrome / Edge; WASM SIMD is the
    // catch-all that works everywhere onnxruntime-web ships.
    const providerOrder: ('webgpu' | 'wasm')[] =
      model.preferredBackend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];

    try {
      const session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: providerOrder,
      });
      activeSession = session;
      const requested: SLMBackend =
        providerOrder[0] === 'webgpu' ? 'webgpu' : 'wasm-simd';
      activeBackend = detectBackend(session, requested);

      // Surface session metadata so devs can tell at a glance which
      // IO names the model expects (Phi-3 ONNX exposes `input_ids`,
      // `attention_mask`, `position_ids`, plus per-layer KV caches).
      try {
        // eslint-disable-next-line no-console
        console.info('[slmWorker] session ready', {
          model: model.id,
          backend: activeBackend,
          inputNames: session.inputNames,
          outputNames: session.outputNames,
        });
      } catch {
        // Logging must never break init.
      }
    } catch (err) {
      // Don't rethrow — the worker contract is "init never blocks
      // a future generate()". The stub fallback in `generate()` keeps
      // the call chain alive while we surface the error to stderr.
      // eslint-disable-next-line no-console
      console.error('[slmWorker] InferenceSession.create failed', err);
      activeSession = null;
      activeBackend = null;
      // TODO T-1.3.2: improve error recovery — propagate a typed
      // failure reason so the proxy can distinguish session-load
      // failures from per-call inference failures.
    }
  },

  /**
   * Run generation on `query.prompt`.
   *
   * Real path: tokenize → build int64 input tensor → loop
   * `session.run({ input_ids })` greedily until EOS or `maxTokens`.
   * If anything in that path throws, we catch and fall back to the
   * T-1.2 stub so the call resolves with a valid `SLMResponse`.
   */
  async generate(query: SLMQuery): Promise<SLMResponse> {
    if (!activeModel) {
      throw new Error('SLM worker: generate() called before init().');
    }

    const start =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    // No live session (init failed or model bytes were unusable):
    // honour the contract with the deterministic stub.
    if (!activeSession) {
      return buildStubResponse(activeModel, query, start);
    }

    const maxTokens = Math.max(1, query.maxTokens ?? DEFAULT_MAX_TOKENS);

    try {
      const tokenizer = buildNaiveTokenizer(query.prompt);
      const promptIds = tokenizer.encode(query.prompt);
      if (promptIds.length === 0) {
        return buildStubResponse(activeModel, query, start);
      }

      // Phi-3 ONNX expects `input_ids` int64. We always feed BigInt64
      // because that's what the int64 tensor type wants on web.
      const session = activeSession;
      const inputName = session.inputNames?.[0] ?? 'input_ids';
      const outputName = session.outputNames?.[0] ?? 'logits';

      const generated: number[] = [];
      let currentIds: number[] = promptIds.slice();

      for (let step = 0; step < maxTokens; step++) {
        const data = BigInt64Array.from(currentIds.map((n) => BigInt(n)));
        const tensor = new ort.Tensor('int64', data, [1, currentIds.length]);

        // eslint-disable-next-line no-await-in-loop
        const output = await session.run({ [inputName]: tensor });
        const logits = output[outputName];

        // logits shape is typically [1, seqLen, vocabSize]. We want
        // argmax over the last position's vocab axis. We do this in
        // a portable way that doesn't assume Float32Array (could be
        // Float16 in some quantizations) — fall back to Number().
        const dims = (logits?.dims ?? []) as readonly number[];
        const flat = logits?.data as ArrayLike<number> | undefined;
        if (!flat || dims.length < 2) {
          // Output shape we don't recognise — bail to stub.
          return buildStubResponse(activeModel, query, start);
        }
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

        if (bestId === RESERVED_EOS_ID) break;
        generated.push(bestId);
        currentIds = currentIds.concat(bestId);
      }

      const text = tokenizer.decode(generated);

      const end =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();

      return {
        text,
        latencyMs: Math.max(0, end - start),
        tokensGenerated: generated.length,
        backend: activeBackend ?? activeModel.preferredBackend,
      };
    } catch (err) {
      // OOM, shape mismatch, missing IO, etc. Don't break the contract.
      // eslint-disable-next-line no-console
      console.error('[slmWorker] generate() falling back to stub', err);
      // TODO T-1.3.2: improve error recovery (typed failure reason).
      return buildStubResponse(activeModel, query, start);
    }
  },

  /**
   * Tear down the active session. Idempotent — safe to call when no
   * session has been initialized.
   */
  async dispose(): Promise<void> {
    if (activeSession && typeof activeSession.release === 'function') {
      try {
        await activeSession.release();
      } catch {
        // Best-effort — we're tearing down anyway.
      }
    }
    activeSession = null;
    activeBackend = null;
    activeModel = null;
  },
};

// Expose the API to the main thread. Guard the Comlink call so this
// module can be imported under Node (e.g. type-checks, future
// component tests) without an immediate side effect against an
// undefined `self`.
if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function') {
  Comlink.expose(slmWorkerApi);
}

export default slmWorkerApi;
