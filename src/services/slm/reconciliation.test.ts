/**
 * Tests for the offline → Zettelkasten reconciliation service (Fase 1 T-1.4).
 *
 * Scenarios pin the documented contract:
 *
 *   1. zero pending          → result {attempted:0, succeeded:0, failed:0}
 *   2. all succeed           → all rows flipped, no failures recorded
 *   3. mixed succeed / fail  → succeeded rows flipped, failed rows still
 *                              pending, failure detail surfaced
 *   4. non-Error throw       → string thrown is captured as a failure
 *   5. (Sprint 20 ninth wave) HMAC mismatch → entry dropped, writeFn
 *                              never called, Sentry warning emitted
 *   6. (Sprint 20 ninth wave) legacy entry (no hmac) → passes through
 *                              with a breadcrumb, writeFn called normally
 *
 * The Zettelkasten write function is injected via the public API so the
 * test never imports anything under `src/services/zettelkasten/`. The
 * IndexedDB layer uses fake-indexeddb (same pattern as the rest of the
 * SLM suite).
 */

import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The encrypted queue's AES-GCM path needs a real `crypto.subtle`. Pin the
// Node-native webcrypto before the SUT imports the queue.
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
  writable: true,
});

// `enqueueSession` fires `slm.queue.grew` from a fire-and-forget analytics
// import; stub it so the test process doesn't boot the real IDB-backed queue.
vi.mock('../analytics', () => ({
  analytics: { track: vi.fn(async () => {}), flush: vi.fn(async () => {}) },
}));

// Hoisted Sentry mock so we can assert on `captureMessage` /
// `addBreadcrumb` without the real SDK in scope. The real wrapper
// `withSentryScope` is also imported transitively; it tolerates a
// `Sentry.withScope` that just invokes the callback.
vi.mock('@sentry/core', () => {
  const captureMessageMock = vi.fn(() => 'evt-id');
  const addBreadcrumbMock = vi.fn();
  const captureExceptionMock = vi.fn(() => 'evt-id');
  const withScopeMock = vi.fn(
    (cb: (scope: { setTag: () => void; setContext: () => void }) => unknown) =>
      cb({ setTag: () => {}, setContext: () => {} }),
  );
  return {
    captureMessage: captureMessageMock,
    addBreadcrumb: addBreadcrumbMock,
    captureException: captureExceptionMock,
    withScope: withScopeMock,
    __captureMessageMock: captureMessageMock,
    __addBreadcrumbMock: addBreadcrumbMock,
  };
});

import * as Sentry from '@sentry/core';

import { __resetDeviceKekForTests } from '../security/deviceKek';
import { __resetSessionKeyForTesting } from './hmac';
import {
  __resetEncryptedOfflineQueueForTests,
  enqueueSession,
  listPending,
} from './encryptedOfflineQueue';
import {
  reconcileOfflineSessions,
  type ZettelkastenWriteFn,
} from './reconciliation';
import type { SLMQuery, SLMResponse } from './types';

const sentryMockHandle = Sentry as unknown as {
  __captureMessageMock: ReturnType<typeof vi.fn>;
  __addBreadcrumbMock: ReturnType<typeof vi.fn>;
};

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

const SAMPLE_QUERY: SLMQuery = { prompt: 'reconcile me' };
const SAMPLE_RESPONSE: SLMResponse = {
  text: 'sample',
  latencyMs: 3,
  tokensGenerated: 2,
  backend: 'wasm-simd',
};

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  vi.stubGlobal('sessionStorage', createSessionStorageMock());
  vi.stubGlobal('localStorage', createSessionStorageMock());
  __resetEncryptedOfflineQueueForTests();
  __resetDeviceKekForTests();
  __resetSessionKeyForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  __resetEncryptedOfflineQueueForTests();
  __resetDeviceKekForTests();
  __resetSessionKeyForTesting();
  vi.unstubAllGlobals();
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

  // The worker captured answers offline (no signal in the pit), closed the
  // app, and reopened it. The HMAC key lives in sessionStorage by design and
  // died with the tab, so the tag no longer verifies — but that is not
  // tampering, and the entries used to be DELETED for it.
  it('keeps entries signed in a previous session instead of destroying them', async () => {
    const id = await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    sentryMockHandle.__captureMessageMock.mockClear();

    // Closing the app: the session key is gone, the queue is not.
    __resetSessionKeyForTesting();

    const writeFn: ZettelkastenWriteFn = vi.fn(async () => undefined);
    const result = await reconcileOfflineSessions({ zettelkastenWriteFn: writeFn });

    // Not written — integrity cannot be proven, so it must not enter the
    // safety corpus.
    expect(writeFn).not.toHaveBeenCalled();
    // Not a failure, and above all NOT deleted.
    expect(result.unverifiable).toBe(1);
    expect(result.failed).toBe(0);
    const stillPending = await listPending();
    expect(stillPending.map((s) => s.id)).toContain(id);

    // And no tampering alert: those must stay meaningful for real attacks.
    const tamperAlerts = sentryMockHandle.__captureMessageMock.mock.calls.filter(
      (call) => call[0] === 'slm.queue.hmac_mismatch',
    );
    expect(tamperAlerts).toHaveLength(0);
  });

  it('handles a non-Error throw value gracefully (string thrown)', async () => {
    await enqueueSession(SAMPLE_QUERY, SAMPLE_RESPONSE);
    const writeFn: ZettelkastenWriteFn = vi.fn(async () => {

      throw 'plain-string-failure';
    });

    const result = await reconcileOfflineSessions({
      zettelkastenWriteFn: writeFn,
    });

    expect(result.failed).toBe(1);
    expect(result.failures[0].error).toBe('plain-string-failure');
  });

  // Sprint 20 ninth wave (Bucket B — TM-T03): a tampered queue entry
  // (HMAC mismatch) MUST be dropped before reaching the Zettelkasten
  // write path, and a Sentry warning MUST be raised so an operator
  // can investigate.
  it('drops an entry with HMAC mismatch and never calls writeFn', async () => {
    const id = await enqueueSession(
      { prompt: 'safe-prompt' },
      SAMPLE_RESPONSE,
    );

    // Tamper with the on-disk record: replace the `query.prompt` with
    // an attacker-controlled value but keep the original HMAC tag.
    // The reconciler should detect the mismatch and drop the row.
    const factory = (globalThis as { indexedDB: IDBFactory }).indexedDB;
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('praeventio-slm', 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('offline_sessions', 'readwrite');
        const store = tx.objectStore('offline_sessions');
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          // The record is now encrypted at rest (queryEnvelope /
          // responseEnvelope), so there is no plaintext `query.prompt` to
          // tamper. Instead forge the top-level app-level HMAC tag while
          // leaving the envelopes intact: the record still DECRYPTS fine, but
          // the reconciler's HMAC check over the decrypted (query, response)
          // no longer matches → the tampered row must be dropped with a
          // Sentry warning.
          const rec = getReq.result as Record<string, unknown> & {
            hmac: string;
          };
          rec.hmac = 'attacker-forged-hmac-tag';
          store.put(rec);
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });

    const writeFn: ZettelkastenWriteFn = vi.fn(async ({ payload }) => ({
      nodeId: `node-for-${payload.id}`,
    }));

    const result = await reconcileOfflineSessions({
      zettelkastenWriteFn: writeFn,
    });

    // writeFn must NEVER be called for a tampered entry.
    expect(writeFn).not.toHaveBeenCalled();

    // The entry is counted as failed, and the failure reason mentions
    // the HMAC mismatch so a triage operator can grep logs.
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures[0].sessionId).toBe(id);
    expect(result.failures[0].error).toMatch(/hmac_mismatch/);

    // Sentry was notified.
    expect(sentryMockHandle.__captureMessageMock).toHaveBeenCalled();
    const captureCall = sentryMockHandle.__captureMessageMock.mock
      .calls[0];
    expect(captureCall[0]).toBe('slm.queue.hmac_mismatch');
    expect((captureCall[1] as { level: string }).level).toBe('warning');

    // The tampered entry was deleted from the queue, so the next pass
    // won't see it again.
    const stillPending = await listPending();
    expect(stillPending).toHaveLength(0);
  });

  // Sprint 20 ninth wave (Bucket B — TM-T03): a legacy entry without
  // an `hmac` field passes through one last time so a queue that was
  // already populated before the deploy doesn't get nuked. The
  // reconciler emits a breadcrumb so an operator can monitor whether
  // the legacy population is going to zero before we tighten the rule
  // in Sprint 22.
  it('passes through a legacy entry (no hmac) with a breadcrumb', async () => {
    // Insert a record directly, bypassing enqueueSession, so it has
    // no `hmac` field — simulates an entry written by the previous
    // version of the queue.
    const factory = (globalThis as { indexedDB: IDBFactory }).indexedDB;
    const legacyId = 'legacy-session';
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('praeventio-slm', 2);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('offline_sessions')) {
          db.createObjectStore('offline_sessions', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('offline_sessions', 'readwrite');
        tx.objectStore('offline_sessions').put({
          id: legacyId,
          query: { prompt: 'legacy' },
          response: {
            text: 'legacy-resp',
            latencyMs: 1,
            tokensGenerated: 1,
            backend: 'wasm-simd',
          },
          createdAt: Date.now(),
          reconciled: false,
          // NOTE: no `hmac` field on purpose.
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });

    const writeFn: ZettelkastenWriteFn = vi.fn(async ({ payload }) => ({
      nodeId: `node-for-${payload.id}`,
    }));

    const result = await reconcileOfflineSessions({
      zettelkastenWriteFn: writeFn,
    });

    // Legacy entry made it to writeFn (one last pass).
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    // Breadcrumb fired — an operator can now monitor the unsigned-legacy
    // population in Sentry to know when it's safe to flip to drop.
    const breadcrumbCalls = sentryMockHandle.__addBreadcrumbMock.mock.calls;
    const legacyBreadcrumb = breadcrumbCalls.find(
      (c) =>
        (c[0] as { category?: string }).category ===
        'slm.queue.unsigned_legacy',
    );
    expect(legacyBreadcrumb).toBeDefined();
  });
});
