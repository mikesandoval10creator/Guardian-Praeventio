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
import { IDBFactory as FDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetCacheForTests, cacheModel } from './cache/modelCache';
import { loadModel } from './loader';
import { SlmIntegrityError } from './slmIntegrityGuard';
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
 * SHA-256 of the ASCII bytes "hello" — same canonical fixture used by
 * `slmRuntime.test.ts`. Lets us pin a model descriptor's `expectedSha256`
 * to a known value and feed the loader a body whose bytes hash to it.
 */
const HELLO_SHA256 =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

/** ArrayBuffer of the bytes "hello". */
function helloBuffer(): ArrayBuffer {
  return new TextEncoder().encode('hello').buffer as ArrayBuffer;
}

/** Build a non-streaming Response whose arrayBuffer() yields `buf`. */
function buildArrayBufferResponse(buf: ArrayBuffer): Response {
  return {
    ok: true,
    status: 200,
    body: null,
    headers: { get: () => null },
    arrayBuffer: async () => buf,
  } as unknown as Response;
}

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

// ───────────────────────────────────────────────────────────────────────
// SHA-256 integrity gate (mirrors slmRuntime.ts). The loader pulls model
// WEIGHTS from a CDN; before this gate it returned them unverified, so a
// tampered/corrupted CDN blob (or a poisoned IndexedDB cache row) would be
// handed straight to ORT. These tests pin a descriptor's `expectedSha256`
// and prove the loader rejects bytes whose hash doesn't match — and never
// caches them.
// ───────────────────────────────────────────────────────────────────────
describe('SLM loader — SHA-256 integrity', () => {
  const VERIFIED_MODEL: ModelDescriptor = {
    ...TEST_MODEL,
    id: 'test-loader-verified',
    expectedSha256: HELLO_SHA256,
  };

  it('accepts a fresh download whose hash matches the pinned expectedSha256', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(buildArrayBufferResponse(helloBuffer()));

    const out = await loadModel(VERIFIED_MODEL, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(out.byteLength).toBe(5); // "hello"
    expect(new Uint8Array(out)[0]).toBe('h'.charCodeAt(0));

    // Verified bytes are cached → a second load is a cache hit (no fetch).
    const fetchSpy2 = vi.fn();
    const out2 = await loadModel(VERIFIED_MODEL, {
      fetchImpl: fetchSpy2 as unknown as typeof fetch,
    });
    expect(fetchSpy2).not.toHaveBeenCalled();
    expect(out2.byteLength).toBe(5);
  });

  it('REJECTS a fresh download whose hash does NOT match — and never caches it', async () => {
    // Descriptor expects HELLO_SHA256 but the CDN serves tampered bytes.
    const tampered = new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(buildArrayBufferResponse(tampered));

    await expect(
      loadModel(VERIFIED_MODEL, {
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(SlmIntegrityError);

    // The poisoned bytes must NOT have been persisted: a subsequent load
    // (with a good body this time) must re-fetch rather than serve the
    // rejected blob from cache.
    const goodFetch = vi
      .fn()
      .mockResolvedValue(buildArrayBufferResponse(helloBuffer()));
    const out = await loadModel(VERIFIED_MODEL, {
      fetchImpl: goodFetch as unknown as typeof fetch,
    });
    expect(goodFetch).toHaveBeenCalledTimes(1);
    expect(out.byteLength).toBe(5);
  });

  it('REJECTS a cache hit whose bytes do not match the pinned hash (poisoned cache)', async () => {
    // Simulate a tampered IndexedDB row: cache holds bytes that do NOT
    // hash to the descriptor's expectedSha256.
    const poisoned = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
    await cacheModel(VERIFIED_MODEL.id, poisoned);

    const fetchSpy = vi.fn();
    await expect(
      loadModel(VERIFIED_MODEL, {
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(SlmIntegrityError);
    // Cache-hit path fails closed BEFORE any network fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows an unpinned model (no expectedSha256) — back-compat staging path', async () => {
    // TEST_MODEL has no expectedSha256 → integrity is a no-op and the
    // loader behaves exactly as before this gate landed.
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(buildArrayBufferResponse(helloBuffer()));
    const out = await loadModel(TEST_MODEL, {
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(out.byteLength).toBe(5);
  });
});
