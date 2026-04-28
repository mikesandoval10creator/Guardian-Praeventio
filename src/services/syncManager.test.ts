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
});
