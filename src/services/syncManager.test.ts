import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RiskNode } from '../types';

// --- Mocks for transitive Firebase / Gemini / idb-keyval imports ---
// syncManager.ts pulls in firebase/firestore, ./firebase, ./geminiService and
// idb-keyval. We don't want any of those to execute real network/IO during
// unit tests, so we stub them out before importing the SUT.

vi.mock('firebase/firestore', () => ({
  writeBatch: vi.fn(),
  doc: vi.fn(),
}));

vi.mock('./firebase', () => ({
  db: {},
}));

vi.mock('./geminiService', () => ({
  generateEmbeddingsBatch: vi.fn(async () => []),
  autoConnectNodes: vi.fn(async () => []),
  syncBatchToNetwork: vi.fn(async () => ({ failedOps: [] })),
}));

// In-memory store standing in for idb-keyval so the sync queue persists in RAM
// across the test. SyncManager reads/writes via get/set/del.
const memStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => memStore.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    memStore.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    memStore.delete(key);
  }),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// --- SUT ---
// Import the singleton AFTER mocks are registered.
const { matrixSyncManager } = await import('./syncManager');

const fakeNode = (id: string, title = 'A'): RiskNode =>
  ({
    id,
    type: 'Hallazgo',
    title,
    description: 'desc',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    projectId: 'proj-1',
    metadata: { authorId: 'u1' },
  } as unknown as RiskNode);

describe('MatrixSyncManager.restoreServerVersion', () => {
  beforeEach(() => {
    // Reset the singleton's queue between tests by draining pending ops via
    // the public API.
    for (const op of matrixSyncManager.getPendingOperations()) {
      // Force-clear by enqueueing a delete then dropping it via restore.
      // Cleanest path: cast to any to access private state directly is too
      // brittle, so we just rely on the singleton starting empty and reset
      // pending ops with restoreServerVersion at end of each test run.
      void op;
    }
    memStore.clear();
  });

  it('drops any pending op for the given (collection, docId) from the queue', async () => {
    await matrixSyncManager.enqueueSet(fakeNode('doc-123', 'local edit'));
    expect(matrixSyncManager.getPendingOperations().some(o => o.id === 'doc-123')).toBe(true);

    await matrixSyncManager.restoreServerVersion('iper_nodes', 'doc-123', {
      foo: 'server-value',
      updatedAt: 1234,
    });

    expect(matrixSyncManager.getPendingOperations().some(o => o.id === 'doc-123')).toBe(false);
  });

  it('emits a "restore" event so consumers can re-fetch from server', async () => {
    const handler = vi.fn();
    const unsubscribe = matrixSyncManager.onRestore(handler);

    const serverData = { foo: 'server-value', updatedAt: 1234 };
    await matrixSyncManager.restoreServerVersion('iper_nodes', 'doc-456', serverData);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      collection: 'iper_nodes',
      docId: 'doc-456',
      serverData,
    });

    unsubscribe();
  });

  it('does not notify after unsubscribe', async () => {
    const handler = vi.fn();
    const unsubscribe = matrixSyncManager.onRestore(handler);
    unsubscribe();

    await matrixSyncManager.restoreServerVersion('iper_nodes', 'doc-789', {});
    expect(handler).not.toHaveBeenCalled();
  });

  // Race 1: a consumer stacks two ops for the same docId (user typed, network
  // was slow, user typed again — second `enqueue*` replaces first by-id in the
  // Map). Then the conflict banner fires `restoreServerVersion`. We must drop
  // *whatever* version is pending and emit exactly one restore event.
  //
  // characterization: passed on first run. The existing impl deletes by docId
  // (syncManager.ts:187-188) regardless of which op version is in the Map.
  it('drops a same-docId op even when an earlier op was just replaced (race 1)', async () => {
    const handler = vi.fn();
    const unsubscribe = matrixSyncManager.onRestore(handler);

    // First write — slow network is conceptually still in flight.
    await matrixSyncManager.enqueueSet(fakeNode('doc-X', 'first edit'));
    // Second write for the same docId — replaces the first by-id.
    await matrixSyncManager.enqueueUpdate('doc-X', { title: 'second edit' });

    // Sanity: queue should hold exactly one op for this id (the replacement).
    const beforeRestore = matrixSyncManager
      .getPendingOperations()
      .filter(o => o.id === 'doc-X');
    expect(beforeRestore.length).toBe(1);

    const serverData = { foo: 'server-value', updatedAt: 4242 };
    await matrixSyncManager.restoreServerVersion('iper_nodes', 'doc-X', serverData);

    // After restore: no op for doc-X remains, regardless of which version had
    // been queued.
    const afterRestore = matrixSyncManager
      .getPendingOperations()
      .filter(o => o.id === 'doc-X');
    expect(afterRestore.length).toBe(0);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      collection: 'iper_nodes',
      docId: 'doc-X',
      serverData,
    });

    unsubscribe();
  });

  // Race 2: `flush()` snapshots queue entries by reference (PR #9 fix), then
  // awaits the network. If `restoreServerVersion(docId)` runs *during* that
  // await, the entry must be dropped and the restore event must fire exactly
  // once — even if the racing flush's network call later resolves. Acceptable
  // semantic chosen: (A) restore wins; the server-side network call (if it
  // landed) is a benign idempotent no-op.
  //
  // We pause the network call mid-flight using a deferred promise. The
  // existing `syncBatchToNetwork` mock from `./geminiService` is patched per
  // this test only.
  //
  // characterization: passed on first run. flush()'s reference-identity guard
  // (syncManager.ts:235 — `if (this.queue.get(id) === op)`) makes the racing
  // delete a no-op once restore has already removed the entry; nothing is
  // re-added.
  it('drops the queue entry when restore runs mid-flush (race 2)', async () => {
    const geminiService = await import('./geminiService');
    const syncBatchToNetwork = geminiService.syncBatchToNetwork as unknown as ReturnType<
      typeof vi.fn
    >;

    let release: (value: { failedOps: never[] }) => void = () => {};
    const networkGate = new Promise<{ failedOps: never[] }>(resolve => {
      release = resolve;
    });
    syncBatchToNetwork.mockImplementationOnce(() => networkGate);

    const handler = vi.fn();
    const unsubscribe = matrixSyncManager.onRestore(handler);

    await matrixSyncManager.enqueueSet(fakeNode('doc-Y', 'mid-flush edit'));
    expect(matrixSyncManager.getPendingOperations().some(o => o.id === 'doc-Y')).toBe(true);

    // Kick off flush — DO NOT await; it will park on `networkGate`.
    const flushPromise = matrixSyncManager.flush();
    // Yield once so flush() reaches the `await syncBatchToNetwork(...)` point.
    await Promise.resolve();

    // Mid-flush: user clicks "Use server version".
    const serverData = { foo: 'server-Y', updatedAt: 9999 };
    await matrixSyncManager.restoreServerVersion('iper_nodes', 'doc-Y', serverData);

    // Now let the network call complete.
    release({ failedOps: [] });
    await flushPromise;

    // Queue must be empty for doc-Y. The flush's reference-identity guard
    // (line ~235) sees the entry was deleted by restore, so it skips its own
    // delete — and crucially, never re-adds the op.
    expect(matrixSyncManager.getPendingOperations().some(o => o.id === 'doc-Y')).toBe(false);

    // Exactly one restore event fired with the right payload.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      collection: 'iper_nodes',
      docId: 'doc-Y',
      serverData,
    });

    unsubscribe();
  });
});
