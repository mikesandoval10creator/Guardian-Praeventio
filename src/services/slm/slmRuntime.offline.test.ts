/**
 * Offline contract tests for `slmRuntime.ts`.
 *
 * These prove the **SLM-without-internet** guarantee: once the model is
 * cached in IndexedDB, `loadModel()` returns successfully **without
 * making a single network call**. That's the emergency-without-internet
 * contract — if these tests pass, the runtime will work on a device
 * that loses connectivity right after the first launch.
 *
 * `fake-indexeddb/auto` polyfills the IDB globals so the cache layer
 * runs the same code path it would in a browser.
 */

import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCacheForTests,
  cacheBundle,
  cacheModel,
  loadCachedModel,
} from './cache/modelCache';
import { MODEL_REGISTRY } from './registry';
import {
  createSlmRuntime,
  type OnnxInferenceSessionLike,
  type OnnxRuntimeLike,
} from './slmRuntime';

// Phi-3 mini real hashes (registry-pinned). The fake digest below maps
// `principal` / `companion` strings to these hashes so the integrity
// guard treats stubbed bytes as the real model.
const PHI_ID = MODEL_REGISTRY[0]!.id;
const QWEN_ID = MODEL_REGISTRY[1]!.id;
const PHI_PRINCIPAL_SHA =
  '16b8e5d28a757c37bbfa7d9420fd094c0c20e3615ca3c203b5b9501015045c8f';
const PHI_COMPANION_SHA =
  '41d30b87f06b52e6b24c4e2e65a6a14e5c9fb5bc6f495fac17b19c6bc7875ff5';
const QWEN_SHA =
  'b11c1dd99efd57e6c6e5bc4443a019931a5fbd5dd500d48644d8225f5ce0b2cb';
const HELLO_SHA =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

function fakeOrt(): OnnxRuntimeLike {
  const session: OnnxInferenceSessionLike = {
    inputNames: ['input_ids'],
    outputNames: ['logits'],
    handler: { _executionProviders: ['webgpu'] },
    release: vi.fn(async () => undefined),
  };
  return {
    InferenceSession: {
      create: vi.fn(async () => session) as unknown as OnnxRuntimeLike['InferenceSession']['create'],
    },
  };
}

function hexToBuffer(hex: string): ArrayBuffer {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out.buffer;
}

/**
 * Hash-aware digest that maps content tokens to known SHA-256 values
 * so the integrity guard treats stub payloads as the real model.
 */
function installFakeDigest(map: Record<string, string>) {
  return vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
    async (_alg: AlgorithmIdentifier, data: BufferSource) => {
      const bytes =
        data instanceof Uint8Array
          ? data
          : new Uint8Array(data as ArrayBuffer);
      const txt = new TextDecoder().decode(bytes);
      // Match by string content; default to hello if unknown.
      const hex = map[txt] ?? HELLO_SHA;
      return hexToBuffer(hex);
    },
  );
}

describe('slmRuntime — offline contract (cache-first)', () => {
  beforeEach(() => {
    // Fresh IDB for every test case.
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Qwen (single file): primer load descarga + persiste cache + 2do load NO toca red', async () => {
    const digestSpy = installFakeDigest({ qwen_bytes: QWEN_SHA });

    // First load: cache miss → network.
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => new TextEncoder().encode('qwen_bytes').buffer,
        }) as unknown as Response,
    );
    const runtime = createSlmRuntime();
    const first = await runtime.loadModel(QWEN_ID, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      ortFactory: async () => fakeOrt(),
    });
    expect(first.observedSha256).toBe(QWEN_SHA);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Cache persisted.
    const cached = await loadCachedModel(QWEN_ID);
    expect(cached).not.toBeNull();
    expect(new TextDecoder().decode(new Uint8Array(cached!))).toBe('qwen_bytes');

    // Second load: cache hit → fetch MUST NOT be called.
    const fetchSpy2 = vi.fn(() => {
      throw new Error('Network must not be touched on cache hit!');
    });
    const second = await runtime.loadModel(QWEN_ID, {
      fetchImpl: fetchSpy2 as unknown as typeof fetch,
      ortFactory: async () => fakeOrt(),
    });
    expect(second.observedSha256).toBe(QWEN_SHA);
    expect(fetchSpy2).not.toHaveBeenCalled();

    digestSpy.mockRestore();
  });

  it('Phi-3 (split bundle): primer load descarga 2 archivos + persiste cada uno + 2do load NO toca red', async () => {
    const digestSpy = installFakeDigest({
      principal: PHI_PRINCIPAL_SHA,
      companion: PHI_COMPANION_SHA,
    });

    const fetchSpy = vi.fn(async (url: string) => {
      const body = url.includes('_data')
        ? new TextEncoder().encode('companion').buffer
        : new TextEncoder().encode('principal').buffer;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => body,
      } as unknown as Response;
    });
    const runtime = createSlmRuntime();
    const first = await runtime.loadModel(PHI_ID, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      ortFactory: async () => fakeOrt(),
    });
    expect(first.observedSha256).toBe(PHI_PRINCIPAL_SHA);
    // Fan-out: principal + companion = 2 calls.
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Second load: full bundle from cache → 0 network calls.
    const fetchSpy2 = vi.fn(() => {
      throw new Error('Network must not be touched on bundle cache hit!');
    });
    const second = await runtime.loadModel(PHI_ID, {
      fetchImpl: fetchSpy2 as unknown as typeof fetch,
      ortFactory: async () => fakeOrt(),
    });
    expect(second.observedSha256).toBe(PHI_PRINCIPAL_SHA);
    expect(fetchSpy2).not.toHaveBeenCalled();

    digestSpy.mockRestore();
  });

  it('cache + integrity: bytes corruptos en cache → SlmIntegrityError, NO se carga', async () => {
    // Pre-cargar el cache con bytes mal — el digest devolverá HELLO_SHA
    // que NO matchea QWEN_SHA del registry. Integrity debe rechazar.
    await cacheModel(QWEN_ID, new TextEncoder().encode('corrupted').buffer);
    installFakeDigest({}); // todos los inputs → HELLO_SHA por default

    const runtime = createSlmRuntime();
    const fetchSpy = vi.fn();
    await expect(
      runtime.loadModel(QWEN_ID, {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        ortFactory: async () => fakeOrt(),
      }),
    ).rejects.toThrow(/integrity check failed/);
    // Importante: NO se fue a la red (el cache es la fuente, error es
    // contra los bytes cached). El caller debe llamar a deleteCachedModel
    // antes de retry.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bundle parcial (companion faltante): cache miss → re-fetch completo', async () => {
    // Solo cachear el principal, NO el companion.
    await cacheModel(PHI_ID, new TextEncoder().encode('principal').buffer);

    installFakeDigest({
      principal: PHI_PRINCIPAL_SHA,
      companion: PHI_COMPANION_SHA,
    });

    let fetchCount = 0;
    const fetchSpy = vi.fn(async (url: string) => {
      fetchCount++;
      const body = url.includes('_data')
        ? new TextEncoder().encode('companion').buffer
        : new TextEncoder().encode('principal').buffer;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => body,
      } as unknown as Response;
    });
    const runtime = createSlmRuntime();
    const result = await runtime.loadModel(PHI_ID, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      ortFactory: async () => fakeOrt(),
    });
    expect(result.observedSha256).toBe(PHI_PRINCIPAL_SHA);
    // Cache incompleto → loadCachedBundle devuelve null → fan-out completo
    expect(fetchCount).toBe(2);
  });

  it('bypassCache:true fuerza re-descarga incluso con cache poblado', async () => {
    await cacheModel(QWEN_ID, new TextEncoder().encode('cached_qwen').buffer);
    installFakeDigest({
      cached_qwen: QWEN_SHA,
      fresh_qwen: QWEN_SHA,
    });

    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => new TextEncoder().encode('fresh_qwen').buffer,
        }) as unknown as Response,
    );
    const runtime = createSlmRuntime();
    await runtime.loadModel(QWEN_ID, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      ortFactory: async () => fakeOrt(),
      bypassCache: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('skipCachePersist:true descarga pero NO escribe al cache', async () => {
    installFakeDigest({ ephemeral: QWEN_SHA });
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => new TextEncoder().encode('ephemeral').buffer,
        }) as unknown as Response,
    );
    const runtime = createSlmRuntime();
    await runtime.loadModel(QWEN_ID, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      ortFactory: async () => fakeOrt(),
      skipCachePersist: true,
    });
    // Cache sigue vacío.
    const cached = await loadCachedModel(QWEN_ID);
    expect(cached).toBeNull();
  });

  it('cacheBundle + loadCachedBundle: roundtrip preservando filenames y bytes', async () => {
    const principal = new Uint8Array([1, 2, 3, 4]);
    const companion = new Uint8Array([5, 6, 7, 8, 9]);
    await cacheBundle('test-model', [
      { filename: 'onnx/model_q4.onnx', payload: principal },
      { filename: 'onnx/model_q4.onnx_data', payload: companion },
    ]);

    const { loadCachedBundle } = await import('./cache/modelCache');
    const bundle = await loadCachedBundle(
      'test-model',
      'onnx/model_q4.onnx',
      ['onnx/model_q4.onnx_data'],
    );
    expect(bundle).not.toBeNull();
    expect(bundle!).toHaveLength(2);
    expect(bundle![0]!.filename).toBe('onnx/model_q4.onnx');
    expect(Array.from(bundle![0]!.payload)).toEqual([1, 2, 3, 4]);
    expect(bundle![1]!.filename).toBe('onnx/model_q4.onnx_data');
    expect(Array.from(bundle![1]!.payload)).toEqual([5, 6, 7, 8, 9]);
  });

  it('loadCachedBundle: companion faltante devuelve null (incomplete bundle)', async () => {
    await cacheModel('test-model', new Uint8Array([1, 2, 3]).buffer);
    const { loadCachedBundle } = await import('./cache/modelCache');
    const bundle = await loadCachedBundle(
      'test-model',
      'onnx/model.onnx',
      ['onnx/model.onnx_data'], // missing
    );
    expect(bundle).toBeNull();
  });
});
