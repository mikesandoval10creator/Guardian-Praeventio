/**
 * Tests for `slmRuntime.ts` — the C.9 ONNX runtime wrapper.
 *
 * No real model downloads, no real ORT. The injected `ortFactory` returns
 * a fake `InferenceSession` so we can assert:
 *   - integrity guard runs BEFORE session create
 *   - mismatch on expectedSha256 → SlmIntegrityError (and NO session create)
 *   - executionProviders are passed as `['webgpu', 'wasm']`
 *   - release() forwards to session.release()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MODEL_REGISTRY } from './registry';
import {
  SlmIntegrityError,
  createSlmRuntime,
  resolveWeightUrl,
  type OnnxInferenceSessionLike,
  type OnnxRuntimeLike,
} from './slmRuntime';

const HELLO_SHA256 =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

function helloPayload(): ArrayBuffer {
  return new TextEncoder().encode('hello').buffer;
}

function buildFakeOrt(opts: {
  createSpy?: ReturnType<typeof vi.fn>;
  session?: Partial<OnnxInferenceSessionLike>;
}): OnnxRuntimeLike {
  const session: OnnxInferenceSessionLike = {
    inputNames: ['input_ids'],
    outputNames: ['logits'],
    handler: { _executionProviders: ['webgpu'] },
    release: vi.fn(async () => undefined),
    ...opts.session,
  };
  return {
    InferenceSession: {
      create:
        opts.createSpy ??
        (vi.fn(async () => session) as unknown as OnnxRuntimeLike['InferenceSession']['create']),
    },
  };
}

function buildFetchReturning(payload: ArrayBuffer): typeof fetch {
  return (vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => payload,
  })) as unknown) as typeof fetch;
}

// Sprint 54: registry[0] (phi-3-mini) is now a SPLIT model with
// .onnx_data companion → the basic single-file load path tests use the
// Qwen entry (no companions) so the fetch stub doesn't have to also
// satisfy companion integrity. Split-bundle behaviour gets its own
// `loadModel split` describe below.
const QWEN_ID = MODEL_REGISTRY[1].id;
const PHI_ID = MODEL_REGISTRY[0].id;

describe('slmRuntime.loadModel', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws for an unknown model id', async () => {
    const runtime = createSlmRuntime();
    await expect(
      runtime.loadModel('does-not-exist', {
        fetchImpl: buildFetchReturning(helloPayload()),
        ortFactory: async () => buildFakeOrt({}),
      }),
    ).rejects.toThrow(/unknown model id/);
  });

  it('downloads bytes, computes SHA-256, opens session with webgpu+wasm providers', async () => {
    const createSpy = vi.fn(
      async (_buf: ArrayBuffer | Uint8Array, _opts?: { executionProviders?: ReadonlyArray<string> }) => ({
        inputNames: ['input_ids'],
        outputNames: ['logits'],
        handler: { _executionProviders: ['webgpu'] },
        release: vi.fn(async () => undefined),
      }),
    );
    const runtime = createSlmRuntime();
    const loaded = await runtime.loadModel(QWEN_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      // Force integrity to pass (registry has no hash for phi-3-mini today).
      expectedSha256Override: HELLO_SHA256,
      ortFactory: async () =>
        ({
          InferenceSession: { create: createSpy },
        }) as unknown as OnnxRuntimeLike,
    });

    expect(loaded.modelId).toBe(QWEN_ID);
    expect(loaded.observedSha256).toBe(HELLO_SHA256);
    expect(loaded.backend).toBe('webgpu');

    // executionProviders must be ['webgpu', 'wasm'] (primary + fallback).
    expect(createSpy).toHaveBeenCalledOnce();
    const optsArg = createSpy.mock.calls[0][1] as {
      executionProviders?: ReadonlyArray<string>;
    };
    expect(optsArg.executionProviders).toEqual(['webgpu', 'wasm']);
  });

  it('throws SlmIntegrityError on hash mismatch — and never opens a session', async () => {
    const createSpy = vi.fn();
    const runtime = createSlmRuntime();
    await expect(
      runtime.loadModel(QWEN_ID, {
        fetchImpl: buildFetchReturning(helloPayload()),
        expectedSha256Override:
          '0000000000000000000000000000000000000000000000000000000000000000',
        ortFactory: async () =>
          ({
            InferenceSession: { create: createSpy },
          }) as unknown as OnnxRuntimeLike,
      }),
    ).rejects.toBeInstanceOf(SlmIntegrityError);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('allows null expected hash (staging mode) but still records observed hash', async () => {
    const runtime = createSlmRuntime();
    const loaded = await runtime.loadModel(QWEN_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      expectedSha256Override: null,
      ortFactory: async () => buildFakeOrt({}),
    });
    expect(loaded.observedSha256).toBe(HELLO_SHA256);
  });

  it('reports wasm-simd backend when ORT chose the wasm provider', async () => {
    const runtime = createSlmRuntime();
    const loaded = await runtime.loadModel(QWEN_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      expectedSha256Override: HELLO_SHA256,
      ortFactory: async () =>
        buildFakeOrt({
          session: { handler: { _executionProviders: ['wasm'] } },
        }),
    });
    expect(loaded.backend).toBe('wasm-simd');
  });

  it('propagates fetch failure as a clear error', async () => {
    const runtime = createSlmRuntime();
    const failingFetch = (vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown) as typeof fetch;
    await expect(
      runtime.loadModel(QWEN_ID, {
        fetchImpl: failingFetch,
        ortFactory: async () => buildFakeOrt({}),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('honours caller-supplied AbortSignal', async () => {
    const runtime = createSlmRuntime();
    const controller = new AbortController();
    controller.abort();
    const watchedFetch = vi.fn(
      async (
        _u: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.signal?.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => helloPayload(),
        } as unknown as Response;
      },
    );
    await expect(
      runtime.loadModel(QWEN_ID, {
        fetchImpl: watchedFetch as unknown as typeof fetch,
        signal: controller.signal,
        ortFactory: async () => buildFakeOrt({}),
      }),
    ).rejects.toThrow();
  });
});

describe('slmRuntime.release', () => {
  it('calls session.release() when present', async () => {
    const releaseSpy = vi.fn(async () => undefined);
    const runtime = createSlmRuntime();
    const loaded = await runtime.loadModel(QWEN_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      expectedSha256Override: HELLO_SHA256,
      ortFactory: async () =>
        buildFakeOrt({ session: { release: releaseSpy } }),
    });
    await runtime.release(loaded);
    expect(releaseSpy).toHaveBeenCalledOnce();
  });

  it('is a no-op when the session has no release()', async () => {
    const runtime = createSlmRuntime();
    const loaded = await runtime.loadModel(QWEN_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      expectedSha256Override: HELLO_SHA256,
      ortFactory: async () => buildFakeOrt({ session: { release: undefined } }),
    });
    await expect(runtime.release(loaded)).resolves.toBeUndefined();
  });

  it('swallows errors from session.release() (best-effort teardown)', async () => {
    const releaseSpy = vi.fn(async () => {
      throw new Error('release boom');
    });
    const runtime = createSlmRuntime();
    const loaded = await runtime.loadModel(QWEN_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      expectedSha256Override: HELLO_SHA256,
      ortFactory: async () =>
        buildFakeOrt({ session: { release: releaseSpy } }),
    });
    await expect(runtime.release(loaded)).resolves.toBeUndefined();
    expect(releaseSpy).toHaveBeenCalledOnce();
  });
});

// ────────────────────────────────────────────────────────────────────────
// inferStream — Sprint 54+ streaming greedy loop con AbortSignal
// ────────────────────────────────────────────────────────────────────────

describe('slmRuntime.inferStream', () => {
  // Construye un fake session que emite N tokens fijos y luego EOS=2.
  function makeStreamingSession(tokens: number[]) {
    let step = 0;
    return {
      inputNames: ['input_ids'],
      outputNames: ['logits'],
      handler: { _executionProviders: ['webgpu'] },
      run: vi.fn(async () => {
        const vocabSize = 256;
        const flat = new Float32Array(vocabSize);
        // Si ya emitimos todos los tokens del plan, devolvemos EOS=2.
        const nextId = step < tokens.length ? tokens[step]! : 2;
        flat[nextId] = 100;
        step++;
        return {
          logits: {
            data: flat,
            dims: [1, 1, vocabSize],
          },
        };
      }),
      release: vi.fn(async () => undefined),
    };
  }

  it('emite onToken por cada token + retorna texto completo', async () => {
    // ids 65='A', 66='B', 67='C' en byte-level tokenizer (charCode).
    const fakeSession = makeStreamingSession([65, 66, 67]);
    const loaded = {
      modelId: 'test',
      descriptor: {} as never,
      observedSha256: 'a'.repeat(64),
      backend: 'webgpu' as const,
      session: fakeSession as unknown as OnnxInferenceSessionLike,
    };
    // Cargar ORT global stub para que el runtime pueda construir tensors.
    const ortStub = {
      InferenceSession: { create: vi.fn(async () => fakeSession) },
      Tensor: class FakeTensor {
        constructor(
          public type: string,
          public data: unknown,
          public dims: number[],
        ) {}
      },
    } as unknown as OnnxRuntimeLike;
    // Inject vía global window — el runtime hace dynamic import.
    // En tests vitest, mockeamos el import directamente.
    vi.doMock('onnxruntime-web', () => ortStub);

    const runtime = createSlmRuntime();
    const tokens: string[] = [];
    const text = await runtime.inferStream(loaded, 'hola', {
      onToken: (t) => tokens.push(t),
      maxTokens: 10,
    });

    // El byte-level tokenizer convierte 65→'A', 66→'B', 67→'C'
    expect(tokens).toEqual(['A', 'B', 'C']);
    expect(text).toBe('ABC');

    vi.doUnmock('onnxruntime-web');
  });

  it('AbortSignal ya abortado antes de empezar → retorna cadena vacía sin invocar run', async () => {
    const fakeSession = makeStreamingSession([65, 66]);
    const runSpy = fakeSession.run;
    const loaded = {
      modelId: 'test',
      descriptor: {} as never,
      observedSha256: 'a'.repeat(64),
      backend: 'webgpu' as const,
      session: fakeSession as unknown as OnnxInferenceSessionLike,
    };
    const runtime = createSlmRuntime();
    const controller = new AbortController();
    controller.abort();
    const result = await runtime.inferStream(loaded, 'hola', {
      signal: controller.signal,
    });
    expect(result).toBe('');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('prompt vacío → retorna cadena vacía sin invocar run', async () => {
    const fakeSession = makeStreamingSession([]);
    const loaded = {
      modelId: 'test',
      descriptor: {} as never,
      observedSha256: 'a'.repeat(64),
      backend: 'webgpu' as const,
      session: fakeSession as unknown as OnnxInferenceSessionLike,
    };
    const runtime = createSlmRuntime();
    const result = await runtime.inferStream(loaded, '');
    expect(result).toBe('');
  });

  it('EOS (id=2) corta el loop temprano', async () => {
    // Solo 1 token antes del EOS implícito (después de tokens=[65], step=1
    // → nextId=2 EOS).
    const fakeSession = makeStreamingSession([65]);
    const ortStub = {
      InferenceSession: { create: vi.fn(async () => fakeSession) },
      Tensor: class FakeTensor {
        constructor(
          public type: string,
          public data: unknown,
          public dims: number[],
        ) {}
      },
    } as unknown as OnnxRuntimeLike;
    vi.doMock('onnxruntime-web', () => ortStub);

    const loaded = {
      modelId: 'test',
      descriptor: {} as never,
      observedSha256: 'a'.repeat(64),
      backend: 'webgpu' as const,
      session: fakeSession as unknown as OnnxInferenceSessionLike,
    };
    const runtime = createSlmRuntime();
    const tokens: string[] = [];
    const text = await runtime.inferStream(loaded, 'p', {
      onToken: (t) => tokens.push(t),
      maxTokens: 100,
    });
    expect(tokens).toEqual(['A']);
    expect(text).toBe('A');

    vi.doUnmock('onnxruntime-web');
  });

  it('maxTokens cap respetado (corta antes de EOS si maxTokens es bajo)', async () => {
    // Stream infinito de 65='A'; sin maxTokens correría forever.
    const fakeSession = {
      inputNames: ['input_ids'],
      outputNames: ['logits'],
      handler: { _executionProviders: ['webgpu'] },
      run: vi.fn(async () => {
        const vocabSize = 256;
        const flat = new Float32Array(vocabSize);
        flat[65] = 100;
        return {
          logits: { data: flat, dims: [1, 1, vocabSize] },
        };
      }),
      release: vi.fn(async () => undefined),
    };
    const ortStub = {
      InferenceSession: { create: vi.fn(async () => fakeSession) },
      Tensor: class FakeTensor {
        constructor(
          public type: string,
          public data: unknown,
          public dims: number[],
        ) {}
      },
    } as unknown as OnnxRuntimeLike;
    vi.doMock('onnxruntime-web', () => ortStub);

    const loaded = {
      modelId: 'test',
      descriptor: {} as never,
      observedSha256: 'a'.repeat(64),
      backend: 'webgpu' as const,
      session: fakeSession as unknown as OnnxInferenceSessionLike,
    };
    const runtime = createSlmRuntime();
    const tokens: string[] = [];
    await runtime.inferStream(loaded, 'p', {
      onToken: (t) => tokens.push(t),
      maxTokens: 5,
    });
    expect(tokens).toHaveLength(5);

    vi.doUnmock('onnxruntime-web');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Sprint 54: split-model load path (Phi-3 ONNX-web with .onnx_data)
// ────────────────────────────────────────────────────────────────────────

describe('slmRuntime.loadModel (Sprint 54 split bundle)', () => {
  // Real Phi-3 mini hashes from the registry. These match exactly what
  // the descriptor declares, so we don't need to override anything —
  // the bundle integrity check runs against the registry-pinned values.
  const PHI_PRINCIPAL_SHA =
    '16b8e5d28a757c37bbfa7d9420fd094c0c20e3615ca3c203b5b9501015045c8f';
  const PHI_COMPANION_SHA =
    '41d30b87f06b52e6b24c4e2e65a6a14e5c9fb5bc6f495fac17b19c6bc7875ff5';

  // Build a fetch that maps each URL to a payload whose computed SHA-256
  // matches the registry-pinned hash for that file. We can't actually
  // produce 1.06GB of real ONNX bytes, so we just stub the digest call.
  // Instead, the tests use registry mocking — but rather than mock the
  // crypto subtle, we'll use a hash-aware fetch that returns content
  // matching the expected hash via a precomputed lookup.

  it('fans out fetch for principal + companion and threads externalData into ORT', async () => {
    // We can't fabricate bytes that hash to specific values, so this
    // test patches `crypto.subtle.digest` to return whatever hash the
    // registry expects for the URL being fetched. That isolates the
    // bundle-orchestration logic without coupling to real SHA-256.
    const fetchUrls: string[] = [];
    const fakeFetch = (vi.fn(async (url: string) => {
      fetchUrls.push(url);
      // Distinguishable payloads so the orchestrator can't accidentally
      // mix them up — bundle indexing relies on order matching files[].
      const body = url.includes('_data')
        ? new TextEncoder().encode('companion').buffer
        : new TextEncoder().encode('principal').buffer;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => body,
      };
    }) as unknown) as typeof fetch;

    // Mock subtle.digest so the integrity check passes deterministically.
    const realSubtle = globalThis.crypto.subtle;
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async (_alg: AlgorithmIdentifier, data: BufferSource) => {
        const bytes =
          data instanceof Uint8Array
            ? data
            : new Uint8Array(data as ArrayBuffer);
        const txt = new TextDecoder().decode(bytes);
        const hex = txt === 'principal' ? PHI_PRINCIPAL_SHA : PHI_COMPANION_SHA;
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return out.buffer;
      },
    );

    let externalDataReceived: unknown = undefined;
    const createSpy = vi.fn(
      async (
        _buf: ArrayBuffer | Uint8Array,
        opts?: { executionProviders?: ReadonlyArray<string>; externalData?: unknown },
      ) => {
        externalDataReceived = opts?.externalData;
        return {
          inputNames: ['input_ids'],
          outputNames: ['logits'],
          handler: { _executionProviders: ['webgpu'] },
          release: vi.fn(async () => undefined),
        };
      },
    );

    try {
      const runtime = createSlmRuntime();
      const loaded = await runtime.loadModel(PHI_ID, {
        fetchImpl: fakeFetch,
        ortFactory: async () =>
          ({
            InferenceSession: { create: createSpy },
          }) as unknown as OnnxRuntimeLike,
      });

      // Both URLs hit.
      expect(fetchUrls).toHaveLength(2);
      expect(fetchUrls[0]).toMatch(/model_q4\.onnx$/);
      expect(fetchUrls[1]).toMatch(/model_q4\.onnx_data$/);

      // ORT received externalData with companion under its registry path.
      expect(Array.isArray(externalDataReceived)).toBe(true);
      const ed = externalDataReceived as Array<{ path: string }>;
      expect(ed).toHaveLength(1);
      expect(ed[0]!.path).toBe('onnx/model_q4.onnx_data');

      // observedSha256 reports the principal hash.
      expect(loaded.observedSha256).toBe(PHI_PRINCIPAL_SHA);
      expect(loaded.modelId).toBe(PHI_ID);
    } finally {
      digestSpy.mockRestore();
      expect(globalThis.crypto.subtle).toBe(realSubtle);
    }
  });

  it('throws SlmIntegrityError with companion path when only the companion mismatches', async () => {
    const fakeFetch = (vi.fn(async (url: string) => {
      const body = url.includes('_data')
        ? new TextEncoder().encode('wrong-companion').buffer
        : new TextEncoder().encode('principal').buffer;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => body,
      };
    }) as unknown) as typeof fetch;

    // Principal hashes to the registry value, companion to a different value.
    const BAD_COMPANION_SHA = 'a'.repeat(64);
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async (_alg: AlgorithmIdentifier, data: BufferSource) => {
        const bytes =
          data instanceof Uint8Array
            ? data
            : new Uint8Array(data as ArrayBuffer);
        const txt = new TextDecoder().decode(bytes);
        const hex =
          txt === 'principal' ? PHI_PRINCIPAL_SHA : BAD_COMPANION_SHA;
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return out.buffer;
      },
    );

    const createSpy = vi.fn();
    try {
      const runtime = createSlmRuntime();
      let err: unknown;
      try {
        await runtime.loadModel(PHI_ID, {
          fetchImpl: fakeFetch,
          ortFactory: async () =>
            ({
              InferenceSession: { create: createSpy },
            }) as unknown as OnnxRuntimeLike,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SlmIntegrityError);
      // Error context names the offending companion file, NOT just the model.
      expect((err as Error).message).toContain('model_q4.onnx_data');
      // ORT never sees these bytes when integrity fails.
      expect(createSpy).not.toHaveBeenCalled();
    } finally {
      digestSpy.mockRestore();
    }
  });
});

describe('resolveWeightUrl', () => {
  it('builds the canonical HF /resolve/main/<file> URL', () => {
    const url = resolveWeightUrl({
      id: 't',
      name: 'T',
      size: 1,
      url: 'https://huggingface.co/foo/bar',
      weightFilename: 'onnx/model.onnx',
      format: 'onnx-int4',
      license: 'MIT',
      preferredBackend: 'webgpu',
      quantization: 'int4',
    });
    expect(url).toBe('https://huggingface.co/foo/bar/resolve/main/onnx/model.onnx');
  });

  it('returns descriptor.url as-is when weightFilename is missing', () => {
    const url = resolveWeightUrl({
      id: 't',
      name: 'T',
      size: 1,
      url: 'https://example.com/model.onnx',
      format: 'onnx-int4',
      license: 'MIT',
      preferredBackend: 'webgpu',
      quantization: 'int4',
    });
    expect(url).toBe('https://example.com/model.onnx');
  });

  it('returns the URL as-is when it already contains /resolve/', () => {
    const url = resolveWeightUrl({
      id: 't',
      name: 'T',
      size: 1,
      url: 'https://huggingface.co/foo/bar/resolve/main/file.onnx',
      weightFilename: 'onnx/model.onnx',
      format: 'onnx-int4',
      license: 'MIT',
      preferredBackend: 'webgpu',
      quantization: 'int4',
    });
    expect(url).toBe('https://huggingface.co/foo/bar/resolve/main/file.onnx');
  });
});
