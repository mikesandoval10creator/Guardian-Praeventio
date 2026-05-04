/**
 * Tests for the IndexedDB-backed SLM model cache (Fase 1 T-1.2).
 *
 * Vitest runs these under the default `node` environment, which has no
 * native IndexedDB. We polyfill it via `fake-indexeddb/auto` — a top-level
 * import that installs `globalThis.indexedDB` and the related globals
 * before this file's module body executes.
 *
 * Each test resets the cache singleton (`__resetCacheForTests`) and the
 * underlying fake DB so cases stay independent. We also force a fresh
 * `IDBFactory` between cases to avoid cross-test bleed if upgrade logic
 * misfires.
 */

import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetCacheForTests,
  cacheModel,
  deleteCachedModel,
  getCachedModelBytes,
  loadCachedModel,
} from './modelCache';

/** Build a deterministic ArrayBuffer of `size` bytes filled with `fill`. */
function makeBlob(size: number, fill: number): ArrayBuffer {
  const buf = new ArrayBuffer(size);
  new Uint8Array(buf).fill(fill);
  return buf;
}

beforeEach(() => {
  // Brand-new IDBFactory => brand-new in-memory DB universe per test.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  __resetCacheForTests();
});

afterEach(() => {
  __resetCacheForTests();
});

describe('SLM modelCache (IndexedDB)', () => {
  it('round-trips a stored blob byte-for-byte', async () => {
    const blob = makeBlob(64, 0xab);
    await cacheModel('round-trip-id', blob);

    const out = await loadCachedModel('round-trip-id');
    expect(out).not.toBeNull();
    expect(out!.byteLength).toBe(64);

    const view = new Uint8Array(out!);
    expect(view[0]).toBe(0xab);
    expect(view[63]).toBe(0xab);
  });

  it('returns null on a cache miss', async () => {
    const out = await loadCachedModel('never-cached');
    expect(out).toBeNull();
  });

  it('reports zero bytes for an uncached model', async () => {
    const bytes = await getCachedModelBytes('not-here');
    expect(bytes).toBe(0);
  });

  it('reports the exact byte size of a cached blob', async () => {
    await cacheModel('sized', makeBlob(1024, 0x01));
    const bytes = await getCachedModelBytes('sized');
    expect(bytes).toBe(1024);
  });

  it('replaces an existing entry on re-cache (put semantics)', async () => {
    await cacheModel('replace-me', makeBlob(32, 0x11));
    expect(await getCachedModelBytes('replace-me')).toBe(32);

    await cacheModel('replace-me', makeBlob(128, 0x22));
    const after = await loadCachedModel('replace-me');
    expect(after!.byteLength).toBe(128);
    expect(new Uint8Array(after!)[0]).toBe(0x22);
  });

  it('deletes an entry idempotently', async () => {
    await cacheModel('to-delete', makeBlob(8, 0xff));
    expect(await loadCachedModel('to-delete')).not.toBeNull();

    await deleteCachedModel('to-delete');
    expect(await loadCachedModel('to-delete')).toBeNull();

    // Second delete must not throw.
    await expect(deleteCachedModel('to-delete')).resolves.toBeUndefined();
  });

  it('keeps separate models isolated by id', async () => {
    await cacheModel('alpha', makeBlob(16, 0x0a));
    await cacheModel('beta', makeBlob(32, 0x0b));

    const a = await loadCachedModel('alpha');
    const b = await loadCachedModel('beta');
    expect(a!.byteLength).toBe(16);
    expect(b!.byteLength).toBe(32);
    expect(new Uint8Array(a!)[0]).toBe(0x0a);
    expect(new Uint8Array(b!)[0]).toBe(0x0b);
  });
});
