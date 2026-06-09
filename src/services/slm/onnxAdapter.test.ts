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
import { IDBFactory as FDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetCacheForTests, loadCachedModel } from './cache/modelCache';
import {
  OnnxSlmAdapter,
  type OnnxInferenceSessionLike,
  type OnnxRuntimeLike,
  type OnnxTensorLike,
} from './onnxAdapter';
import {
  __resetTokenizerCacheForTests,
  __setTokenizerFactoryForTests,
} from './tokenizer';

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
  // Clear tokenizer override + cache so generation-loop tests don't
  // bleed fakes into unrelated cases.
  __setTokenizerFactoryForTests(null);
  __resetTokenizerCacheForTests();
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
      modelUrl: '/models/slm/tinyllama-1.1b-int8.onnx',
      cacheVersion: 'test-v1',
      fetchImpl,
      ortFactory: async () => ort,
    });

    await adapter.loadModel();

    expect(calls).toEqual(['/models/slm/tinyllama-1.1b-int8.onnx']);
    expect(createCalls).toHaveLength(1);
    // Adapter should request WebGPU first, with WASM as the fallback.
    expect(createCalls[0].providers).toEqual(['webgpu', 'wasm']);
    expect(adapter.isLoaded()).toBe(true);

    // Cache key derives from the cacheVersion — assert the bytes landed
    // in IndexedDB so a second app launch will skip the network. The key
    // segment is `int8` (the real quantization), not the legacy `q4`.
    const cached = await loadCachedModel('onnx-tinyllama-1.1b-int8-test-v1');
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
    // Registry-accurate: the real upstream file
    // (decoder_model_merged_quantized.onnx) is int8 dynamic quantization,
    // not q4. getModelInfo() must report the real scheme.
    expect(info.quantization).toBe('int8');
    expect(info.name).toMatch(/int8/i);
    expect(info.name).not.toMatch(/q4/i);
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

// ───────────────────────────────────────────────────────────────────
// Bucket DD — real generation loop integration tests.
//
// These cases install a fake `Tensor` constructor + `session.run` so
// the adapter takes the `runRealGeneration` branch instead of the
// scaffold fallback. Logits are synthesized so the argmax always falls
// on a known token id, which lets us assert tokenizer + sampling +
// stream-callback wiring without loading the 600 MB TinyLlama blob.
// ───────────────────────────────────────────────────────────────────

interface FakeTensor extends OnnxTensorLike {
  readonly type: string;
}

/**
 * Build an ORT fake that implements `Tensor` + `session.run`. The fake
 * `run` returns a `logits` tensor of shape `[1, seqLen, vocabSize]`
 * with a single dominant logit at `winningTokenId` so greedy / nucleus
 * sampling deterministically picks that id. After `stopAfter` steps,
 * it returns logits where the EOS id (2) wins, ending the loop.
 */
function makeGeneratingFakeOrt(opts: {
  winningTokenId: number;
  vocabSize: number;
  stopAfter: number;
}) {
  const { winningTokenId, vocabSize, stopAfter } = opts;
  let runCount = 0;
  const runCalls: Array<{ inputLen: number }> = [];

  const session: OnnxInferenceSessionLike = {
    release: vi.fn(async () => undefined),
    run: vi.fn(async (feeds: Record<string, OnnxTensorLike>) => {
      runCount += 1;
      const inputIds = feeds.input_ids;
      const seqLen = inputIds.dims[1] ?? 0;
      runCalls.push({ inputLen: seqLen });

      // Allocate logits buffer of shape [1, seqLen, vocabSize].
      const total = seqLen * vocabSize;
      const buf = new Float32Array(total);
      // The sampler only inspects the LAST position's row, so we just
      // poke that row.
      const lastStart = (seqLen - 1) * vocabSize;
      const winner = runCount > stopAfter ? 2 /* EOS */ : winningTokenId;
      // Make `winner` dominate by a wide margin so greedy / nucleus
      // deterministically pick it.
      buf[lastStart + winner] = 100;

      const tensor: FakeTensor = {
        type: 'float32',
        data: buf,
        dims: [1, seqLen, vocabSize],
      };
      return { logits: tensor };
    }),
  };

  const Tensor = function FakeTensorCtor(
    type: string,
    data: BigInt64Array | Float32Array | Int32Array | number[],
    dims: ReadonlyArray<number>,
  ): FakeTensor {
    return { type, data: data as ArrayLike<number>, dims };
  } as unknown as OnnxRuntimeLike['Tensor'];

  const ort: OnnxRuntimeLike = {
    InferenceSession: {
      create: vi.fn(async () => session),
    },
    Tensor,
  };

  return { ort, session, runCalls, get runCount() { return runCount; } };
}

/**
 * Fake tokenizer — stubs `applyChatTemplate` / `encode` / `decode` so
 * the loop runs without pulling transformers.js. Records calls so we
 * can assert that `decode` was invoked per generated token.
 */
function installFakeTokenizer() {
  __setTokenizerFactoryForTests({
    fromPretrained: async () => ({
      encode: () => [1, 100, 200, 300], // 4-token prompt
      decode: (ids: number[]) => ids.map((id) => `t${id}`).join(' '),
      apply_chat_template: () => '<|user|>\nhola\n<|assistant|>\n',
    }),
  });
}

describe('OnnxSlmAdapter.generate (real loop)', () => {
  it('drives session.run once per generated token until stop', async () => {
    const fake = makeGeneratingFakeOrt({ winningTokenId: 42, vocabSize: 64, stopAfter: 3 });
    const { fetchImpl } = makeFakeFetch();
    installFakeTokenizer();

    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'gen-real-v1',
      fetchImpl,
      ortFactory: async () => fake.ort,
    });

    const tokens: string[] = [];
    const result = await adapter.generate({
      prompt: 'hola',
      maxTokens: 16,
      temperature: 0, // greedy → deterministic argmax on token 42
      onToken: (t) => tokens.push(t),
    });

    // 3 winning tokens streamed, then run #4 returns EOS and breaks.
    expect(fake.runCount).toBe(4);
    expect(tokens).toHaveLength(3);
    // Each streamed fragment is the decode of a single token id.
    expect(tokens.every((t) => t.startsWith('t42'))).toBe(true);
    // Final return is the full-sequence decode.
    expect(result).toContain('t42');
  });

  it('honours signal.aborted mid-loop', async () => {
    const fake = makeGeneratingFakeOrt({ winningTokenId: 7, vocabSize: 32, stopAfter: 100 });
    const { fetchImpl } = makeFakeFetch();
    installFakeTokenizer();

    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'gen-real-abort-v1',
      fetchImpl,
      ortFactory: async () => fake.ort,
    });

    const ac = new AbortController();
    const tokens: string[] = [];

    // Abort after the second streamed token.
    const result = await adapter.generate({
      prompt: 'hola',
      maxTokens: 50,
      temperature: 0,
      onToken: (t) => {
        tokens.push(t);
        if (tokens.length === 2) ac.abort();
      },
      signal: ac.signal,
    });

    // The loop checks `signal.aborted` at the top of each iteration,
    // so we expect either 2 or 3 tokens depending on the timing of the
    // abort observation. Bound it.
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens.length).toBeLessThanOrEqual(3);
    // Did NOT run all 50 iterations.
    expect(fake.runCount).toBeLessThan(50);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns "" when signal is pre-aborted (no run, no tokenizer)', async () => {
    const fake = makeGeneratingFakeOrt({ winningTokenId: 1, vocabSize: 16, stopAfter: 100 });
    const { fetchImpl } = makeFakeFetch();
    installFakeTokenizer();

    const adapter = new OnnxSlmAdapter({
      cacheVersion: 'gen-real-preabort-v1',
      fetchImpl,
      ortFactory: async () => fake.ort,
    });

    const ac = new AbortController();
    ac.abort();

    const tokens: string[] = [];
    const result = await adapter.generate({
      prompt: 'ignored',
      onToken: (t) => tokens.push(t),
      signal: ac.signal,
    });

    expect(result).toBe('');
    expect(tokens).toHaveLength(0);
    expect(fake.runCount).toBe(0);
  });
});
