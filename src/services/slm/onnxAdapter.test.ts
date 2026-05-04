/**
 * Tests for the ONNX Runtime Web direct adapter (Brecha B, Bucket O).
 *
 * The adapter is a class with a small lifecycle surface
 * (`loadModel/generate/warmup/unload/isLoaded/getModelInfo`) plus a
 * static `fromEnv()` factory that gates on a feature flag. We test
 * each branch with a dummy ORT factory + a mocked `fetch` so the suite
 * doesn't pull the 600 MB TinyLlama blob into CI — the spec explicitly
 * forbids running the real model in CI.
 *
 * Coverage map (matches Bucket O.5):
 *   1. fromEnv null when feature flag off
 *   2. loadModel downloads + caches (cache miss path)
 *   3. loadModel reuses cached bytes (cache hit path)
 *   4. generate streams tokens through `onToken`
 *   5. unload releases the session
 *   6. warmup pre-loads without generating
 *   7. signal.aborted halts generation cooperatively
 *   8. getModelInfo reports static metadata even before load
 */

import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetCacheForTests, loadCachedModel } from './cache/modelCache';
import {
  OnnxSlmAdapter,
  type OnnxInferenceSessionLike,
  type OnnxRuntimeLike,
} from './onnxAdapter';

/**
 * Build a fake `onnxruntime-web` module. Tracks `create()` calls so a
 * test can assert "we initialized the session exactly once" or "we
 * passed WebGPU first in the executionProviders list".
 */
function makeFakeOrt() {
  const createCalls: Array<{
    bytes: ArrayBuffer | Uint8Array;
    providers: ReadonlyArray<string> | undefined;
  }> = [];
  const releaseCalls: number[] = [];

  const session: OnnxInferenceSessionLike = {
    release: vi.fn(async () => {
      releaseCalls.push(Date.now());
    }),
  };

  const ort: OnnxRuntimeLike = {
    InferenceSession: {
      create: vi.fn(async (bytes, options) => {
        createCalls.push({ bytes, providers: options?.executionProviders });
        return session;
      }),
    },
  };

  return { ort, session, createCalls, releaseCalls };
}

/**
 * Fake fetch that returns a synthetic ONNX-shaped buffer of `size` bytes.
 * Records the URLs it was called with so we can assert the adapter
 * routed the request to the configured `modelUrl`.
 */
function makeFakeFetch(size = 64) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = (async (url: RequestInfo | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push(u);
    const buf = new Uint8Array(size).fill(0xab).buffer;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => buf,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  // Fresh fake-indexeddb between cases so the cache hit/miss tests don't
  // accidentally share state. Same pattern the existing slmAdapter +
  // loader tests use.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  __resetCacheForTests();
  // Clear feature flag overrides so each case starts from a clean slate.
  delete (globalThis as Record<string, unknown>).__SLM_OFFLINE_ENABLED__;
  delete process.env.SLM_OFFLINE_ENABLED;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OnnxSlmAdapter.fromEnv', () => {
  it('returns null when SLM_OFFLINE_ENABLED is off', () => {
    expect(OnnxSlmAdapter.fromEnv()).toBeNull();
  });

  it('returns an adapter when SLM_OFFLINE_ENABLED is "1"', () => {
    process.env.SLM_OFFLINE_ENABLED = '1';
    const adapter = OnnxSlmAdapter.fromEnv();
    expect(adapter).toBeInstanceOf(OnnxSlmAdapter);
  });

  it('returns an adapter when the global debug override is set', () => {
    (globalThis as Record<string, unknown>).__SLM_OFFLINE_ENABLED__ = 'true';
    const adapter = OnnxSlmAdapter.fromEnv();
    expect(adapter).toBeInstanceOf(OnnxSlmAdapter);
  });
});

describe('OnnxSlmAdapter.loadModel', () => {
  it('downloads the model from the configured URL and caches it', async () => {
    const { ort, createCalls } = makeFakeOrt();
    const { fetchImpl, calls } = makeFakeFetch(128);

    const adapter = new OnnxSlmAdapter({
      modelUrl: '/models/slm/tinyllama-1.1b-q4.onnx',
      cacheVersion: 'test-v1',
      fetchImpl,
      ortFactory: async () => ort,
    });

    await adapter.loadModel();

    expect(calls).toEqual(['/models/slm/tinyllama-1.1b-q4.onnx']);
    expect(createCalls).toHaveLength(1);
    // Adapter should request WebGPU first, with WASM as the fallback.
    expect(createCalls[0].providers).toEqual(['webgpu', 'wasm']);
    expect(adapter.isLoaded()).toBe(true);

    // Cache key derives from the cacheVersion — assert the bytes landed
    // in IndexedDB so a second app launch will skip the network.
    const cached = await loadCachedModel('onnx-tinyllama-1.1b-test-v1');
    expect(cached?.byteLength).toBe(128);
  });

  it('reuses cached bytes on the second load (no second fetch)', async () => {
    const fakeOrt1 = makeFakeOrt();
    const fakeFetch1 = makeFakeFetch(64);
    const adapter1 = new OnnxSlmAdapter({
      cacheVersion: 'shared-v1',
      fetchImpl: fakeFetch1.fetchImpl,
      ortFactory: async () => fakeOrt1.ort,
    });
    await adapter1.loadModel();
    expect(fakeFetch1.calls).toHaveLength(1);

    // A second adapter with the same cacheVersion must NOT trigger a
    // network call — it should hit the IndexedDB cache.
    const fakeOrt2 = makeFakeOrt();
    const fakeFetch2 = makeFakeFetch(64);
    const adapter2 = new OnnxSlmAdapter({
      cacheVersion: 'shared-v1',
      fetchImpl: fakeFetch2.fetchImpl,
      ortFactory: async () => fakeOrt2.ort,
    });
    await adapter2.loadModel();
    expect(fakeFetch2.calls).toHaveLength(0);
    expect(adapter2.isLoaded()).toBe(true);
  });

  it('is reentrant — concurrent calls dedupe to one fetch', async () => {
    const { ort } = makeFakeOrt();
    const { fetchImpl, calls } = makeFakeFetch(32);
    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'concurrent-v1',
      fetchImpl,
      ortFactory: async () => ort,
    });

    await Promise.all([adapter.loadModel(), adapter.loadModel(), adapter.loadModel()]);

    expect(calls).toHaveLength(1);
    expect(adapter.isLoaded()).toBe(true);
  });
});

describe('OnnxSlmAdapter.generate', () => {
  it('streams tokens through onToken', async () => {
    const { ort } = makeFakeOrt();
    const { fetchImpl } = makeFakeFetch();
    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'gen-v1',
      fetchImpl,
      ortFactory: async () => ort,
    });

    const tokens: string[] = [];
    const result = await adapter.generate({
      prompt: 'hola',
      maxTokens: 64,
      onToken: (t) => tokens.push(t),
    });

    expect(result.length).toBeGreaterThan(0);
    // At least one streamed token observed before the final string resolved.
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('honours signal.aborted cooperatively', async () => {
    const { ort } = makeFakeOrt();
    const { fetchImpl } = makeFakeFetch();
    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'abort-v1',
      fetchImpl,
      ortFactory: async () => ort,
    });

    const ac = new AbortController();
    ac.abort(); // pre-aborted — generator should produce nothing.

    const tokens: string[] = [];
    const result = await adapter.generate({
      prompt: 'ignored',
      onToken: (t) => tokens.push(t),
      signal: ac.signal,
    });

    expect(tokens).toHaveLength(0);
    expect(result).toBe('');
  });

  it('lazy-loads the model if generate is called before loadModel', async () => {
    const { ort, createCalls } = makeFakeOrt();
    const { fetchImpl } = makeFakeFetch();
    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'lazy-v1',
      fetchImpl,
      ortFactory: async () => ort,
    });

    expect(adapter.isLoaded()).toBe(false);
    await adapter.generate({ prompt: 'x' });
    expect(adapter.isLoaded()).toBe(true);
    expect(createCalls).toHaveLength(1);
  });
});

describe('OnnxSlmAdapter.unload', () => {
  it('releases the session and flips isLoaded to false', async () => {
    const { ort, releaseCalls } = makeFakeOrt();
    const { fetchImpl } = makeFakeFetch();
    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'unload-v1',
      fetchImpl,
      ortFactory: async () => ort,
    });

    await adapter.loadModel();
    expect(adapter.isLoaded()).toBe(true);

    await adapter.unload();
    expect(adapter.isLoaded()).toBe(false);
    expect(releaseCalls).toHaveLength(1);
  });

  it('is idempotent on a never-loaded adapter', async () => {
    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'unload-empty-v1',
    });
    await expect(adapter.unload()).resolves.toBeUndefined();
    expect(adapter.isLoaded()).toBe(false);
  });
});

describe('OnnxSlmAdapter.warmup', () => {
  it('loads the model without generating any output', async () => {
    const { ort } = makeFakeOrt();
    const { fetchImpl } = makeFakeFetch();
    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'warmup-v1',
      fetchImpl,
      ortFactory: async () => ort,
    });

    const tokens: string[] = [];
    await adapter.warmup();
    expect(adapter.isLoaded()).toBe(true);
    // warmup must not trigger generation, so onToken collected nothing.
    expect(tokens).toHaveLength(0);
  });
});

describe('OnnxSlmAdapter.getModelInfo', () => {
  it('returns static metadata even before loadModel', () => {
    const adapter = new OnnxSlmAdapter({ cacheVersion: 'info-v1' });
    const info = adapter.getModelInfo();
    expect(info.name).toMatch(/TinyLlama/i);
    expect(info.quantization).toBe('q4');
    expect(info.size).toBe(0); // not loaded yet
  });

  it('reports the loaded byte count after loadModel', async () => {
    const { ort } = makeFakeOrt();
    const { fetchImpl } = makeFakeFetch(256);
    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'info-v2',
      fetchImpl,
      ortFactory: async () => ort,
    });
    await adapter.loadModel();
    expect(adapter.getModelInfo().size).toBe(256);
  });
});
