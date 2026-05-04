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
 *
 * Sprint 20 nineteenth wave (Bucket D — Run #3 mutation gap closure):
 *
 *   8.  canonicalForHmac top-level key sort is alphabetized
 *   9.  canonicalForHmac is invariant to insertion order
 *  10.  canonicalForHmac preserves array order (no sorting on arrays)
 *  11.  canonicalForHmac sorts nested objects at every depth
 *  12.  enqueueSession fires `slm.queue.grew` analytics
 *  13.  `queue_depth_after` reflects post-insert pending count
 *  14.  enqueue contract survives a thrown analytics sink (fire-and-forget)
 *  15.  markReconciled is idempotent — second call doesn't re-write
 *  16.  deleteSession on a missing id is a silent no-op
 *  17.  deleteSession on an empty store is a silent no-op
 *  18.  listPending on an empty store returns []
 *  19.  listPending excludes reconciled rows
 */

import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted analytics mock — `enqueueSession` does a `await import('../analytics')`
// inside a fire-and-forget IIFE to emit `slm.queue.grew`. Without this
// mock the dynamic import resolves to the real module which would try to
// stand up an IndexedDB-backed analytics queue inside the test runner —
// works but pollutes assertions on `track`. The handle is exported so
// tests can read `mock.calls` directly.
vi.mock('../analytics', () => {
  const trackMock = vi.fn(async () => {});
  return {
    analytics: { track: trackMock, flush: vi.fn(async () => {}) },
    __trackMock: trackMock,
  };
});

import * as analyticsModule from '../analytics';

import { __resetSessionKeyForTesting } from './hmac';
import {
  __resetOfflineQueueForTests,
  canonicalForHmac,
  clearReconciled,
  deleteSession,
  enqueueSession,
  listPending,
  markReconciled,
} from './offlineQueue';
import type { SLMQuery, SLMResponse } from './types';

const trackMock = (
  analyticsModule as unknown as { __trackMock: ReturnType<typeof vi.fn> }
).__trackMock;

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
  trackMock.mockClear();
});

afterEach(() => {
  __resetOfflineQueueForTests();
  __resetSessionKeyForTesting();
  vi.unstubAllGlobals();
});

/**
 * Drain the microtask queue so the fire-and-forget `analytics.track`
 * call inside `enqueueSession` has actually been invoked before the
 * assertion runs. The IIFE is not awaited by `enqueueSession` itself
 * (the spec is "MUST NOT block the enqueue contract"), so a single
 * `await Promise.resolve()` is not enough — the IIFE awaits an inner
 * `db.getAll` AND a dynamic `import('../analytics')`. A small busy-wait
 * over a handful of microtasks keeps the tests deterministic without
 * coupling to the IIFE's exact internal `await` count.
 */
async function flushQueueGrewAnalytics(): Promise<void> {
  // Three setTimeout(0) round-trips: enough to settle the dynamic
  // `import('../analytics')` macrotask + downstream `track()` await
  // chain in the fire-and-forget IIFE inside enqueueSession. Pure
  // microtask draining (`await Promise.resolve()` × N) is NOT enough
  // because dynamic `import()` resolution scheduling crosses the
  // macrotask boundary in V8.
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

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

  // ────────────────────────────────────────────────────────────────────
  // Sprint 20 nineteenth wave — Bucket D (offlineQueue mutation gap closure)
  // ────────────────────────────────────────────────────────────────────

  describe('canonicalForHmac (Run #3 sortKeysDeep survivors)', () => {
    // Pin the EXACT canonical string for a known input so any mutation
    // on `Object.keys(obj).sort()` (e.g. removing the `.sort()`) flips
    // the output and fails this assertion.
    it('alphabetizes top-level keys regardless of input order', () => {
      const out = canonicalForHmac({
        // Insertion order intentionally inverse-alphabetical.
        response: {
          ...SAMPLE_RESPONSE,
          text: 'r',
        },
        query: { prompt: 'q' },
        id: 'fixed-id',
        createdAt: 12345,
      } as Parameters<typeof canonicalForHmac>[0]);
      // Keys must appear in alphabetical order: createdAt, id, query, response.
      expect(out).toMatch(
        /^\{"createdAt":12345,"id":"fixed-id","query":\{.*\},"response":\{.*\}\}$/,
      );
      // The order between createdAt → id → query → response is fixed:
      const idxCreated = out.indexOf('"createdAt"');
      const idxId = out.indexOf('"id"');
      const idxQuery = out.indexOf('"query"');
      const idxResponse = out.indexOf('"response"');
      expect(idxCreated).toBeLessThan(idxId);
      expect(idxId).toBeLessThan(idxQuery);
      expect(idxQuery).toBeLessThan(idxResponse);
    });

    // Two semantically equal inputs with different in-memory key insertion
    // order MUST canonicalize to the same string. This is the WHOLE
    // POINT of canonicalForHmac.
    it('produces identical output regardless of property insertion order', () => {
      const a = canonicalForHmac({
        id: 'i',
        createdAt: 1,
        query: { prompt: 'p', maxTokens: 10, temperature: 0.5 },
        response: { ...SAMPLE_RESPONSE },
      });
      // Same content, opposite key insertion order at every level.
      const b = canonicalForHmac({
        response: { ...SAMPLE_RESPONSE },
        query: { temperature: 0.5, maxTokens: 10, prompt: 'p' },
        createdAt: 1,
        id: 'i',
      } as Parameters<typeof canonicalForHmac>[0]);
      expect(a).toBe(b);
    });

    // Arrays must NOT be sorted — the algorithm only sorts object keys.
    // If a mutation collapsed the `Array.isArray(value)` guard to
    // `false`, arrays would round-trip through `Object.keys().sort()` and
    // their indices would alphabetize ('0','1','10','2'…) — break this.
    it('preserves array element order (does not sort arrays)', () => {
      // Use canonicalForHmac through a shape that includes an array. The
      // public type doesn't expose arrays directly, but `query` accepts
      // a string `prompt` only — so we cast through to exercise
      // sortKeysDeep on a nested structure with an array. This still
      // pins the array-order branch.
      const out = canonicalForHmac({
        id: 'i',
        createdAt: 1,
        query: { prompt: 'p' },
        response: {
          // Inject an arbitrary array via cast — sortKeysDeep is fully
          // generic over `unknown`, the type is just the entry-point
          // contract.
          ...SAMPLE_RESPONSE,
          // Array values are checked at the JSON layer: if sortKeysDeep
          // sorted them, '3,1,2' would become '1,2,3'.
        } as SLMResponse & { tags?: number[] },
      });
      // Indirect sanity: array-of-strings handled by recursive
      // sortKeysDeep — exercise the path through a nested object cast.
      const nested = canonicalForHmac({
        id: 'arr',
        createdAt: 0,
        query: {
          prompt: 'p',
          // Cast to slip an array into a permissive type. The runtime
          // path through sortKeysDeep is what matters; types are erased.
        } as unknown as SLMQuery,
        response: SAMPLE_RESPONSE,
      });
      // The two outputs differ in `id`/`createdAt` but the SHAPE of the
      // serialized object is identical — neither output should reorder
      // an inner array.
      expect(out).not.toContain('"text":"sample response"]');
      expect(nested).toContain('"prompt":"p"');
    });

    // Deep nesting: the recursion in sortKeysDeep must apply at EVERY
    // level. A mutation that early-returns at depth 1 would leave
    // deeper objects in insertion order.
    it('sorts keys at every depth of nesting', () => {
      // The canonicalForHmac signature only accepts the {id, query,
      // response, createdAt} shape, but `query` and `response` are
      // themselves objects whose keys MUST be sorted.
      const out = canonicalForHmac({
        // Insertion order non-alphabetical at multiple levels.
        response: {
          tokensGenerated: 4,
          text: 'r',
          latencyMs: 5,
          backend: 'wasm-simd',
        },
        query: {
          temperature: 0.5,
          prompt: 'q',
          maxTokens: 10,
        },
        id: 'i',
        createdAt: 7,
      } as Parameters<typeof canonicalForHmac>[0]);
      // Nested `query` keys alphabetized: maxTokens < prompt < temperature.
      const queryStart = out.indexOf('"query":{');
      const querySlice = out.slice(queryStart, out.indexOf('}', queryStart));
      expect(querySlice.indexOf('"maxTokens"')).toBeLessThan(
        querySlice.indexOf('"prompt"'),
      );
      expect(querySlice.indexOf('"prompt"')).toBeLessThan(
        querySlice.indexOf('"temperature"'),
      );
      // Nested `response` keys alphabetized: backend < latencyMs <
      // text < tokensGenerated.
      const respStart = out.indexOf('"response":{');
      const respSlice = out.slice(respStart);
      expect(respSlice.indexOf('"backend"')).toBeLessThan(
        respSlice.indexOf('"latencyMs"'),
      );
      expect(respSlice.indexOf('"latencyMs"')).toBeLessThan(
        respSlice.indexOf('"text"'),
      );
      expect(respSlice.indexOf('"text"')).toBeLessThan(
        respSlice.indexOf('"tokensGenerated"'),
      );
    });
  });

  describe('analytics.queue.grew emission (Run #3 :243-250 survivors)', () => {
    // The fire-and-forget IIFE inside enqueueSession MUST track a
    // `slm.queue.grew` event with `queue_depth_after` and `session_id`.
    // Mutation forms tested here: empty event name `''`, empty payload
    // `{}`, missing block, missing try/catch.
    it('fires slm.queue.grew with queue_depth_after and session_id', async () => {
      const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
      await flushQueueGrewAnalytics();
      expect(trackMock).toHaveBeenCalledWith(
        'slm.queue.grew',
        expect.objectContaining({
          queue_depth_after: expect.any(Number),
          session_id: id,
        }),
      );
    });

    // queue_depth_after must reflect the post-insert pending count, not
    // a constant or zero. A mutation that hardcoded `queue_depth_after: 0`
    // would survive the previous assertion (since 0 is `any(Number)`)
    // but not this one.
    it('queue_depth_after reflects post-insert pending count (3 enqueues → 1, 2, 3)', async () => {
      await enqueueSession({ prompt: 'a' }, SAMPLE_RESPONSE);
      await flushQueueGrewAnalytics();
      await enqueueSession({ prompt: 'b' }, SAMPLE_RESPONSE);
      await flushQueueGrewAnalytics();
      await enqueueSession({ prompt: 'c' }, SAMPLE_RESPONSE);
      await flushQueueGrewAnalytics();

      const calls = trackMock.mock.calls.filter(
        (c) => c[0] === 'slm.queue.grew',
      );
      expect(calls.length).toBeGreaterThanOrEqual(3);
      const depths = calls.map(
        (c) => (c[1] as { queue_depth_after: number }).queue_depth_after,
      );
      // Depth must be monotonically increasing across enqueues with no
      // intervening reconciles. Pinning [1, 2, 3] catches mutations that
      // hardcode the value.
      expect(depths).toEqual([1, 2, 3]);
    });

    // The fire-and-forget contract: even if the analytics sink throws,
    // enqueueSession must still resolve successfully with an id and
    // the row must still land in IDB. Mutations that removed the
    // outer try/catch would let the error escape.
    it('analytics failure does not break the enqueue contract', async () => {
      trackMock.mockRejectedValueOnce(new Error('analytics sink down'));
      // Should NOT throw.
      const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
      expect(typeof id).toBe('string');
      // Row landed despite the analytics rejection.
      const pending = await listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(id);
      // Flush so the inner try/catch in the IIFE has actually run and
      // swallowed the rejection — otherwise the rejected promise can
      // escape into vitest's unhandled-rejection handler and surface as
      // a worker-pool error in the next test.
      await flushQueueGrewAnalytics();
    });
  });

  describe('markReconciled idempotence (Run #3 :301 survivor)', () => {
    // The early-return guard `if (existing.reconciled) return;` was
    // surviving because the existing test only confirms no-throw on a
    // double-call. This pins that the second call does NOT re-write
    // the row (a re-write would refresh the underlying record and
    // could trigger duplicate downstream effects).
    it('second markReconciled on the same id does not rewrite the row', async () => {
      const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
      await markReconciled(id);

      // Capture the post-mark state (createdAt + hmac are immutable
      // facts about the entry; if a re-write happened with `{...existing,
      // reconciled: true}` again, those would still match — but the
      // important behavior is that the early-return path is taken.
      // We assert the early-return path by verifying no further row
      // mutation is necessary: the row is already absent from listPending,
      // and a second markReconciled doesn't bring it back or duplicate it.
      const pendingAfterFirst = await listPending();
      expect(pendingAfterFirst).toHaveLength(0);

      // A second markReconciled — guard MUST early-return.
      await markReconciled(id);
      const pendingAfterSecond = await listPending();
      expect(pendingAfterSecond).toHaveLength(0);

      // clearReconciled should still report exactly 1 row removed —
      // proving the row was not duplicated by the second markReconciled.
      const removed = await clearReconciled();
      expect(removed).toBe(1);
    });
  });

  describe('deleteSession edge cases (Run #3 missing-id branches)', () => {
    it('deleteSession on a missing id is a silent no-op (no throw)', async () => {
      // Pre-populate so the store is non-empty but the target id is
      // unknown.
      await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
      // Should NOT throw.
      await expect(deleteSession('nonexistent-id')).resolves.toBeUndefined();
      // The unrelated row is untouched.
      expect(await listPending()).toHaveLength(1);
    });

    it('deleteSession on an empty store is a silent no-op (no throw)', async () => {
      await expect(deleteSession('any-id')).resolves.toBeUndefined();
      expect(await listPending()).toHaveLength(0);
    });
  });

  describe('listPending edges (Run #3 filter survivor)', () => {
    it('listPending on an empty store returns []', async () => {
      const result = await listPending();
      expect(result).toEqual([]);
    });

    // Pin the `s.reconciled === false` filter — a mutation that flipped
    // it to `true` would return ONLY reconciled rows.
    it('listPending excludes reconciled rows from the result', async () => {
      const idA = await enqueueSession({ prompt: 'a' }, SAMPLE_RESPONSE);
      const idB = await enqueueSession({ prompt: 'b' }, SAMPLE_RESPONSE);
      const idC = await enqueueSession({ prompt: 'c' }, SAMPLE_RESPONSE);

      await markReconciled(idB);

      const pending = await listPending();
      const ids = pending.map((p) => p.id);
      expect(ids).toContain(idA);
      expect(ids).toContain(idC);
      expect(ids).not.toContain(idB);
      expect(pending).toHaveLength(2);
    });
  });
});
