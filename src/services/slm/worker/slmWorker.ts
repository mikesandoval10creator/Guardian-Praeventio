/**
 * SLM Web Worker — runs ONNX Runtime Web off the main thread.
 *
 * Fase 1 (Sprint 20, Bucket Epsilon, T-1.2). This file is the worker
 * script's source: Vite picks it up via `new Worker(new URL(...))` from
 * `../workerProxy.ts`, transpiles it to a module worker, and the main
 * thread talks to it through Comlink.
 *
 * Status as of T-1.2 — SCAFFOLDING ONLY:
 *   - Worker plumbing (Comlink.expose, init/generate/dispose surface)
 *     is real and used by the type-checked main-thread proxy.
 *   - Inference is a STUB. `generate()` returns a deterministic mock
 *     payload with measured latency. The actual `InferenceSession.run`
 *     call lives in T-1.3, where the prompt-encoding / token-decoding
 *     paths arrive. See `// TODO T-1.3` markers below.
 *
 * Why a Worker (rather than running on the main thread):
 *   - ONNX Runtime Web pegs a CPU core during decode; running on the
 *     main thread would jank scrolling and the emergency UI.
 *   - The Worker can hold the (large) `InferenceSession` in module
 *     state without fighting React's StrictMode double-mounts.
 *
 * The worker file is intentionally `// @ts-nocheck` — the WebWorker
 * lib types and the DOM lib types conflict in a single tsconfig, and
 * adding a separate tsconfig for the worker is more ceremony than
 * this stub deserves. T-1.3 will revisit once the inference path is
 * real and the type surface is wider.
 */
// @ts-nocheck
// TODO T-1.3: enable strict types after the worker tsconfig split.

import * as Comlink from 'comlink';

import type { ModelDescriptor, SLMQuery, SLMResponse } from '../types';

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

// TODO T-1.3: hold the actual `InferenceSession` and the tokenizer
// here. For now we just stash the model descriptor so `generate`
// can echo metadata back.

const slmWorkerApi: SlmWorkerApi = {
  /**
   * Bind a model to this worker. In T-1.2 this only records the
   * descriptor; T-1.3 will do the real `InferenceSession.create`
   * call against the supplied `modelBytes`.
   */
  async init(model: ModelDescriptor, _modelBytes: ArrayBuffer): Promise<void> {
    activeModel = model;
    // TODO T-1.3: real session bootstrap with onnxruntime-web.
    //   import * as ort from 'onnxruntime-web';
    //   ort.env.wasm.numThreads = navigator.hardwareConcurrency ?? 1;
    //   session = await ort.InferenceSession.create(modelBytes, {
    //     executionProviders:
    //       model.preferredBackend === 'webgpu' ? ['webgpu'] : ['wasm'],
    //   });
  },

  /**
   * Stub generation path. Returns a deterministic mock string and the
   * measured (real) latency so downstream code (UI loaders, queue
   * persistence) can be exercised end-to-end without a live model.
   *
   * The `latencyMs`, `backend`, and `tokensGenerated` fields are
   * filled with plausible values so consumers don't need to special-
   * case the stub.
   */
  async generate(query: SLMQuery): Promise<SLMResponse> {
    if (!activeModel) {
      throw new Error('SLM worker: generate() called before init().');
    }

    const start =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    // TODO T-1.3: replace this block with the real inference path:
    //   1. tokenize(query.prompt)
    //   2. run session with input ids + attention mask
    //   3. greedy / temperature sampling loop until EOS or maxTokens
    //   4. detokenize -> text
    const mockText =
      `[stub:${activeModel.id}] echoing prompt of ${query.prompt.length} ` +
      `chars (real inference lands in T-1.3)`;

    const end =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    return {
      text: mockText,
      latencyMs: Math.max(0, end - start),
      // The stub doesn't actually decode tokens, so we report a
      // proxy: roughly one "token" per 4 chars of mock output.
      tokensGenerated: Math.ceil(mockText.length / 4),
      backend: activeModel.preferredBackend,
    };
  },

  /**
   * Tear down the active session. Idempotent — safe to call when no
   * session has been initialized.
   */
  async dispose(): Promise<void> {
    activeModel = null;
    // TODO T-1.3: `await session?.release()` once the real session
    // handle is wired up.
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
