/**
 * Tests for `reconciliationRunner.ts` — the wiring layer between
 * `reconcileOfflineSessions()` and the real Zettelkasten `writeNodes`.
 *
 * Covered scenarios (mirror the contract documented at the top of
 * `reconciliationRunner.ts`):
 *
 *   1. queue empty                         → {attempted:0, ...}; writeNodes never called
 *   2. two pending sessions, both succeed  → both flipped to reconciled
 *   3. one succeeds + one fails (writeNodes ok:false)
 *      → one reconciled, one in failures[], the failed row stays pending
 *
 * `writeNodes` is mocked at module scope so we never pull the firebase /
 * fetch graph into this test. The IndexedDB layer uses fake-indexeddb,
 * matching the rest of the SLM suite.
 */

import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The encrypted queue's AES-GCM path needs a real `crypto.subtle`. Pin the
// Node-native webcrypto before the SUT imports the queue (mirrors
// encryptedOfflineQueue.test.ts).
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
  writable: true,
});

// Mock writeNodes BEFORE importing the runner so the runner picks up the
// mocked module. The factory returns a vi.fn() the tests can configure
// per case.
vi.mock('../zettelkasten/persistence/writeNode', () => ({
  writeNodes: vi.fn(),
}));

// `enqueueSession` fires `slm.queue.grew` from a fire-and-forget analytics
// import; stub it so the test process doesn't boot the real IDB-backed
// analytics queue.
vi.mock('../analytics', () => ({
  analytics: { track: vi.fn(async () => {}), flush: vi.fn(async () => {}) },
}));

import { __resetDeviceKekForTests } from '../security/deviceKek';
import {
  __resetEncryptedOfflineQueueForTests,
  enqueueSession,
  listPending,
} from './encryptedOfflineQueue';
import { __resetSessionKeyForTesting } from './hmac';
import { runReconciliation } from './reconciliationRunner';
import { writeNodes } from '../zettelkasten/persistence/writeNode';
import type { SLMResponse } from './types';

const mockedWriteNodes = vi.mocked(writeNodes);

/** Minimal in-memory Storage stub (sessionStorage/localStorage). */
function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => store.delete(k),
    setItem: (k: string, v: string) => store.set(k, String(v)),
  };
}

const SAMPLE_RESPONSE: SLMResponse = {
  text: 'sample SLM output',
  latencyMs: 7,
  tokensGenerated: 5,
  backend: 'wasm-simd',
};

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  vi.stubGlobal('sessionStorage', createStorageMock());
  vi.stubGlobal('localStorage', createStorageMock());
  __resetEncryptedOfflineQueueForTests();
  __resetDeviceKekForTests();
  __resetSessionKeyForTesting();
  mockedWriteNodes.mockReset();
});

afterEach(() => {
  __resetEncryptedOfflineQueueForTests();
  __resetDeviceKekForTests();
  __resetSessionKeyForTesting();
  vi.unstubAllGlobals();
});

describe('SLM reconciliationRunner', () => {
  it('returns {attempted:0, ...} and never calls writeNodes when the queue is empty', async () => {
    const result = await runReconciliation({ projectId: 'proj-empty' });

    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
    expect(mockedWriteNodes).not.toHaveBeenCalled();
  });

  it('marks both sessions reconciled when writeNodes succeeds for each', async () => {
    await enqueueSession({ prompt: 'first' }, SAMPLE_RESPONSE);
    // Tiny delay so createdAt timestamps are distinct (listPending sorts
    // by createdAt and the assertions below pin the call ordering).
    await new Promise((r) => setTimeout(r, 2));
    await enqueueSession({ prompt: 'second' }, SAMPLE_RESPONSE);

    // writeNodes returns a fresh nodeId per call.
    let callCount = 0;
    mockedWriteNodes.mockImplementation(async () => {
      callCount += 1;
      return { ok: true, ids: [`zk-node-${callCount}`] };
    });

    const result = await runReconciliation({ projectId: 'proj-happy' });

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);

    // Queue is drained — both rows flipped reconciled.
    expect(await listPending()).toHaveLength(0);

    // writeNodes called once per session, with the projectId threaded
    // through and a single-node batch shape.
    expect(mockedWriteNodes).toHaveBeenCalledTimes(2);
    const firstCallArgs = mockedWriteNodes.mock.calls[0];
    expect(firstCallArgs[1]).toEqual({ projectId: 'proj-happy' });
    expect(Array.isArray(firstCallArgs[0])).toBe(true);
    expect(firstCallArgs[0]).toHaveLength(1);
    expect(firstCallArgs[0][0].type).toBe('safety-learning');
    expect(firstCallArgs[0][0].severity).toBe('info');
    // Title should derive from the prompt.
    expect(firstCallArgs[0][0].title).toContain('first');
    // Description should derive from the SLM response text.
    expect(firstCallArgs[0][0].description).toBe('sample SLM output');
  });

  it('records a failure and leaves the row pending when writeNodes returns ok:false', async () => {
    const idA = await enqueueSession({ prompt: 'will-succeed' }, SAMPLE_RESPONSE);
    await new Promise((r) => setTimeout(r, 2));
    const idB = await enqueueSession({ prompt: 'will-fail' }, SAMPLE_RESPONSE);

    mockedWriteNodes.mockImplementation(async (nodes) => {
      // Look at the description so we know which session this batch is
      // for (we always pass single-node batches from the runner).
      const desc = nodes[0]?.description ?? '';
      const promptMatch = nodes[0]?.title ?? '';
      // The failing session's prompt was "will-fail" — title contains it.
      if (promptMatch.includes('will-fail')) {
        return { ok: false, status: 503, error: 'firestore unavailable' };
      }
      return { ok: true, ids: [`zk-${desc.slice(0, 4)}`] };
    });

    const result = await runReconciliation({ projectId: 'proj-mixed' });

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].sessionId).toBe(idB);
    // Error message should surface both the status and the server text.
    expect(result.failures[0].error).toMatch(/503/);
    expect(result.failures[0].error).toMatch(/firestore unavailable/);

    // idA gone from pending (reconciled). idB still pending so the next
    // pass retries it.
    const stillPending = await listPending();
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0].id).toBe(idB);
    expect(stillPending[0].reconciled).toBe(false);
    expect(stillPending.find((s) => s.id === idA)).toBeUndefined();
  });

  it('throws if projectId is missing — defensive guard for the app shell wiring', async () => {
    await expect(
      runReconciliation({ projectId: '' }),
    ).rejects.toThrow(/projectId is required/);
  });
});
