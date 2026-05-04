/**
 * Tests for the IndexedDB-backed offline session queue (Fase 1 T-1.4).
 *
 * Same fake-indexeddb pattern as `cache/modelCache.test.ts` and
 * `loader.test.ts`: each case starts with a brand-new `FDBFactory` and
 * the queue's singleton handle is reset, so cases stay independent.
 *
 * Scenarios:
 *
 *   1. enqueue + listPending      — basic round trip
 *   2. multiple enqueues          — chronological ordering preserved
 *   3. markReconciled             — flag flips, listPending hides it
 *   4. clearReconciled            — only reconciled rows removed
 *   5. unknown id                 — markReconciled throws
 *   6. (Sprint 20 ninth wave) enqueue persists an `hmac` tag
 *   7. (Sprint 20 ninth wave) deleteSession removes a row by id
 */

import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetSessionKeyForTesting } from './hmac';
import {
  __resetOfflineQueueForTests,
  clearReconciled,
  deleteSession,
  enqueueSession,
  listPending,
  markReconciled,
} from './offlineQueue';
import type { SLMQuery, SLMResponse } from './types';

/**
 * Minimal in-memory `Storage` mock so the HMAC module's
 * `sessionStorage` lookup resolves to a real Map rather than
 * `undefined` (Node test environment doesn't ship one).
 */
function createSessionStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(k: string) {
      return store.has(k) ? (store.get(k) as string) : null;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    removeItem(k: string) {
      store.delete(k);
    },
    setItem(k: string, v: string) {
      store.set(k, String(v));
    },
  };
}

const SAMPLE_QUERY: SLMQuery = { prompt: 'sample prompt' };
const SAMPLE_RESPONSE: SLMResponse = {
  text: 'sample response',
  latencyMs: 5,
  tokensGenerated: 4,
  backend: 'wasm-simd',
};

beforeEach(() => {
  // Brand-new in-memory DB universe per case.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  vi.stubGlobal('sessionStorage', createSessionStorageMock());
  __resetOfflineQueueForTests();
  __resetSessionKeyForTesting();
});

afterEach(() => {
  __resetOfflineQueueForTests();
  __resetSessionKeyForTesting();
  vi.unstubAllGlobals();
});

describe('SLM offlineQueue (offlineQueue.ts)', () => {
  it('enqueue then listPending returns the persisted item', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(pending[0].query).toEqual(SAMPLE_QUERY);
    expect(pending[0].response).toEqual(SAMPLE_RESPONSE);
    expect(pending[0].reconciled).toBe(false);
    expect(typeof pending[0].createdAt).toBe('number');
  });

  it('multiple enqueues preserve chronological order in listPending', async () => {
    const idA = await enqueueSession(
      { prompt: 'first' },
      { ...SAMPLE_RESPONSE, text: 'first-resp' },
    );
    // 1ms gap so the createdAt timestamps are guaranteed distinct.
    await new Promise((r) => setTimeout(r, 2));
    const idB = await enqueueSession(
      { prompt: 'second' },
      { ...SAMPLE_RESPONSE, text: 'second-resp' },
    );
    await new Promise((r) => setTimeout(r, 2));
    const idC = await enqueueSession(
      { prompt: 'third' },
      { ...SAMPLE_RESPONSE, text: 'third-resp' },
    );

    const pending = await listPending();
    expect(pending.map((p) => p.id)).toEqual([idA, idB, idC]);
    expect(pending.map((p) => p.query.prompt)).toEqual([
      'first',
      'second',
      'third',
    ]);
    // createdAt strictly non-decreasing.
    expect(pending[0].createdAt).toBeLessThanOrEqual(pending[1].createdAt);
    expect(pending[1].createdAt).toBeLessThanOrEqual(pending[2].createdAt);
  });

  it('markReconciled flips the flag and removes the row from listPending', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    expect(await listPending()).toHaveLength(1);

    await markReconciled(id);

    const pending = await listPending();
    expect(pending).toHaveLength(0);

    // Calling twice should be a no-op (no throw).
    await markReconciled(id);
    expect(await listPending()).toHaveLength(0);
  });

  it('clearReconciled removes only reconciled rows; pending rows survive', async () => {
    const idA = await enqueueSession({ prompt: 'a' }, SAMPLE_RESPONSE);
    const idB = await enqueueSession({ prompt: 'b' }, SAMPLE_RESPONSE);
    const idC = await enqueueSession({ prompt: 'c' }, SAMPLE_RESPONSE);

    await markReconciled(idA);
    await markReconciled(idC);

    const removed = await clearReconciled();
    expect(removed).toBe(2);

    // idB is still pending.
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(idB);

    // A second clearReconciled with no reconciled rows returns 0.
    expect(await clearReconciled()).toBe(0);
  });

  it('markReconciled throws on an unknown id', async () => {
    await expect(markReconciled('does-not-exist')).rejects.toThrow(
      /unknown session id/,
    );
  });

  // Sprint 20 ninth wave (Bucket B — TM-T03): every enqueue must
  // persist an HMAC tag alongside the record so the reconciler can
  // verify integrity at drain time.
  it('enqueue persists an hmac tag on the record', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(typeof pending[0].hmac).toBe('string');
    // base64url tag of HMAC-SHA256 is 43 chars unpadded.
    expect((pending[0].hmac as string).length).toBeGreaterThanOrEqual(43);
    // No `+`, `/`, or `=` — it's URL-safe base64url.
    expect(pending[0].hmac as string).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('deleteSession removes a row from the store', async () => {
    const idA = await enqueueSession({ prompt: 'a' }, SAMPLE_RESPONSE);
    const idB = await enqueueSession({ prompt: 'b' }, SAMPLE_RESPONSE);
    expect(await listPending()).toHaveLength(2);
    await deleteSession(idA);
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(idB);
    // Idempotent — deleting again is a no-op (no throw).
    await deleteSession(idA);
    expect(await listPending()).toHaveLength(1);
  });
});
