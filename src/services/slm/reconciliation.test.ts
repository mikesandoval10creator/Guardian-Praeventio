/**
 * Tests for the offline → Zettelkasten reconciliation service (Fase 1 T-1.4).
 *
 * Three scenarios pin the documented contract:
 *
 *   1. zero pending          → result {attempted:0, succeeded:0, failed:0}
 *   2. all succeed           → all rows flipped, no failures recorded
 *   3. mixed succeed / fail  → succeeded rows flipped, failed rows still
 *                              pending, failure detail surfaced
 *
 * The Zettelkasten write function is injected via the public API so the
 * test never imports anything under `src/services/zettelkasten/`. The
 * IndexedDB layer uses fake-indexeddb (same pattern as the rest of the
 * SLM suite).
 */

import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOfflineQueueForTests,
  enqueueSession,
  listPending,
} from './offlineQueue';
import {
  reconcileOfflineSessions,
  type ZettelkastenWriteFn,
} from './reconciliation';
import type { SLMQuery, SLMResponse } from './types';

const SAMPLE_QUERY: SLMQuery = { prompt: 'reconcile me' };
const SAMPLE_RESPONSE: SLMResponse = {
  text: 'sample',
  latencyMs: 3,
  tokensGenerated: 2,
  backend: 'wasm-simd',
};

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  __resetOfflineQueueForTests();
});

afterEach(() => {
  __resetOfflineQueueForTests();
});

describe('SLM reconciliation (reconciliation.ts)', () => {
  it('returns {attempted:0, ...} when the queue is empty', async () => {
    const writeFn = vi.fn(async () => ({ nodeId: 'never-called' }));
    const result = await reconcileOfflineSessions({
      zettelkastenWriteFn: writeFn,
    });

    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('marks all sessions reconciled when every writeFn call succeeds', async () => {
    // Small gaps between enqueues so the createdAt timestamps are
    // distinct — listPending sorts by createdAt and we want the
    // assertion below to pin the ordering of the first call.
    await enqueueSession({ prompt: 'a' }, SAMPLE_RESPONSE);
    await new Promise((r) => setTimeout(r, 2));
    await enqueueSession({ prompt: 'b' }, SAMPLE_RESPONSE);
    await new Promise((r) => setTimeout(r, 2));
    await enqueueSession({ prompt: 'c' }, SAMPLE_RESPONSE);

    const writeFn: ZettelkastenWriteFn = vi.fn(async ({ payload }) => ({
      nodeId: `node-for-${payload.id}`,
    }));

    const result = await reconcileOfflineSessions({
      zettelkastenWriteFn: writeFn,
    });

    expect(result.attempted).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);

    // Queue should now be drained (all three flipped to reconciled).
    expect(await listPending()).toHaveLength(0);

    // writeFn called once per session, with the correct payload type.
    expect(writeFn).toHaveBeenCalledTimes(3);
    const firstCall = (writeFn as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as { type: string; payload: { query: SLMQuery } };
    expect(firstCall.type).toBe('slm-session');
    expect(firstCall.payload.query).toEqual({ prompt: 'a' });
  });

  it('keeps failed sessions pending and records failures', async () => {
    const idA = await enqueueSession({ prompt: 'will-succeed' }, SAMPLE_RESPONSE);
    const idB = await enqueueSession({ prompt: 'will-fail' }, SAMPLE_RESPONSE);

    const writeFn: ZettelkastenWriteFn = vi.fn(async ({ payload }) => {
      if (payload.id === idB) {
        throw new Error('Firestore unavailable');
      }
      return { nodeId: `node-for-${payload.id}` };
    });

    const result = await reconcileOfflineSessions({
      zettelkastenWriteFn: writeFn,
    });

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].sessionId).toBe(idB);
    expect(result.failures[0].error).toMatch(/Firestore unavailable/);

    // idA was reconciled (gone from pending). idB still pending.
    const stillPending = await listPending();
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0].id).toBe(idB);
    // A second pass would retry idB — confirm the queue state is shaped
    // for that.
    expect(stillPending[0].reconciled).toBe(false);

    // Sanity: idA is no longer pending.
    expect(stillPending.find((s) => s.id === idA)).toBeUndefined();
  });

  it('handles a non-Error throw value gracefully (string thrown)', async () => {
    await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const writeFn: ZettelkastenWriteFn = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'plain-string-failure';
    });

    const result = await reconcileOfflineSessions({
      zettelkastenWriteFn: writeFn,
    });

    expect(result.failed).toBe(1);
    expect(result.failures[0].error).toBe('plain-string-failure');
  });
});
