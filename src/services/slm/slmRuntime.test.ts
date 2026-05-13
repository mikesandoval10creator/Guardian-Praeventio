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
    const loaded = await runtime.loadModel(PHI_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      // Force integrity to pass (registry has no hash for phi-3-mini today).
      expectedSha256Override: HELLO_SHA256,
      ortFactory: async () =>
        ({
          InferenceSession: { create: createSpy },
        }) as unknown as OnnxRuntimeLike,
    });

    expect(loaded.modelId).toBe(PHI_ID);
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
      runtime.loadModel(PHI_ID, {
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
    const loaded = await runtime.loadModel(PHI_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      expectedSha256Override: null,
      ortFactory: async () => buildFakeOrt({}),
    });
    expect(loaded.observedSha256).toBe(HELLO_SHA256);
  });

  it('reports wasm-simd backend when ORT chose the wasm provider', async () => {
    const runtime = createSlmRuntime();
    const loaded = await runtime.loadModel(PHI_ID, {
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
      runtime.loadModel(PHI_ID, {
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
      runtime.loadModel(PHI_ID, {
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
    const loaded = await runtime.loadModel(PHI_ID, {
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
    const loaded = await runtime.loadModel(PHI_ID, {
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
    const loaded = await runtime.loadModel(PHI_ID, {
      fetchImpl: buildFetchReturning(helloPayload()),
      expectedSha256Override: HELLO_SHA256,
      ortFactory: async () =>
        buildFakeOrt({ session: { release: releaseSpy } }),
    });
    await expect(runtime.release(loaded)).resolves.toBeUndefined();
    expect(releaseSpy).toHaveBeenCalledOnce();
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
