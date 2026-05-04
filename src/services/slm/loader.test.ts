/**
 * Tests for the cache-aware SLM model loader (Fase 1 T-1.2).
 *
 * The loader's three branches:
 *   1. cache hit                — returns cached bytes, no fetch
 *   2. cache miss               — streams fetch, reports progress, caches
 *   3. fetch error              — surfaces a clear Error
 *
 * IndexedDB is provided by `fake-indexeddb/auto` (same pattern as the
 * `modelCache.test.ts` suite). `fetch` is stubbed per case via the
 * `fetchImpl` option so each test is self-contained.
 */

import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetCacheForTests, cacheModel } from './cache/modelCache';
import { loadModel } from './loader';
import type { ModelDescriptor } from './types';

const TEST_MODEL: ModelDescriptor = {
  id: 'test-loader-model',
  name: 'Loader Test Model',
  size: 64,
  url: 'https://example.invalid/test-model.onnx',
  format: 'onnx-int4',
  license: 'MIT',
  preferredBackend: 'wasm-simd',
  quantization: 'int4',
};

/**
 * Build a `Response`-shaped object with a streaming body. We avoid
 * pulling in `whatwg-fetch` or the undici polyfill — the contract the
 * loader needs (ok, headers.get, body.getReader returning chunks) is
 * small enough to mock by hand.
 */
function buildStreamingResponse(
  chunks: Uint8Array[],
  contentLength: number | null,
): Response {
  let i = 0;
  const reader = {
    read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      if (i < chunks.length) {
        return Promise.resolve({ done: false, value: chunks[i++] });
      }
      return Promise.resolve({ done: true, value: undefined });
    },
  };
  const body = {
    getReader: () => reader,
  } as unknown as ReadableStream<Uint8Array>;

  const headers = new Map<string, string>();
  if (contentLength !== null) {
    headers.set('content-length', String(contentLength));
  }

  return {
    ok: true,
    status: 200,
    body,
    headers: {
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
    },
    arrayBuffer: async () => {
      const total = chunks.reduce((s, c) => s + c.byteLength, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      return merged.buffer;
    },
  } as unknown as Response;
}

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  __resetCacheForTests();
});

afterEach(() => {
  __resetCacheForTests();
});

describe('SLM loader', () => {
  it('returns cached bytes without calling fetch on a cache hit', async () => {
    const cachedBuf = new ArrayBuffer(8);
    new Uint8Array(cachedBuf).fill(0x77);
    await cacheModel(TEST_MODEL.id, cachedBuf);

    const fetchSpy = vi.fn();
    const out = await loadModel(TEST_MODEL, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.byteLength).toBe(8);
    expect(new Uint8Array(out)[0]).toBe(0x77);
  });

  it('streams fetch, reports progress, and caches on a miss', async () => {
    const chunkA = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const chunkB = new Uint8Array([0x05, 0x06]);
    const totalSize = chunkA.byteLength + chunkB.byteLength; // 6

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(buildStreamingResponse([chunkA, chunkB], totalSize));

    const progressEvents: Array<[number, number | null]> = [];
    const out = await loadModel(TEST_MODEL, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      onProgress: (loaded, total) => progressEvents.push([loaded, total]),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(TEST_MODEL.url);
    expect(out.byteLength).toBe(totalSize);
    expect(new Uint8Array(out)[0]).toBe(0x01);
    expect(new Uint8Array(out)[5]).toBe(0x06);

    // Two chunks → at least two progress callbacks; final loaded == total.
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    const last = progressEvents[progressEvents.length - 1];
    expect(last[0]).toBe(totalSize);
    expect(last[1]).toBe(totalSize);

    // A subsequent call should be a cache hit (no second fetch).
    const out2 = await loadModel(TEST_MODEL, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out2.byteLength).toBe(totalSize);
  });

  it('throws a descriptive Error when fetch returns non-ok', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    await expect(
      loadModel(TEST_MODEL, { fetchImpl: fetchSpy as unknown as typeof fetch }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('falls back to arrayBuffer() when the body has no getReader', async () => {
    // Some fetch polyfills (and node-fetch < 3) return a body without
    // a streaming reader. The loader should still resolve successfully.
    const buf = new Uint8Array([0xaa, 0xbb, 0xcc]).buffer;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      headers: { get: (k: string) => (k === 'content-length' ? '3' : null) },
      arrayBuffer: async () => buf,
    } as unknown as Response);

    const progress: Array<[number, number | null]> = [];
    const out = await loadModel(TEST_MODEL, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      onProgress: (l, t) => progress.push([l, t]),
    });
    expect(out.byteLength).toBe(3);
    expect(progress).toEqual([[3, 3]]);
  });
});
