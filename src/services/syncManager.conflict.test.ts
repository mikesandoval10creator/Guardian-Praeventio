// @vitest-environment jsdom
//
// TODO.md §16.2.2 — safety-critical conflict diversion in matrixSyncManager.
//
// Risk being closed: two offline edits of the same incident/inspection/
// emergency/medical/training node raced through `flush()` with NO remote
// comparison — one edit was silently lost (last-write-wins). These tests
// exercise the REAL MatrixSyncManager with Firestore/fetch mocked and pin:
//   (a) safety doc-type + remote divergence → NOTHING is overwritten; the
//       conflict is emitted (`sync-critical-conflict`) AND posted to the
//       server conflict_queue; the local op is marked `conflict` and never
//       re-tried in a loop.
//   (b) non-critical doc types keep the existing behavior bit-for-bit
//       (no remote read, batch flushed).
//   (c) safety doc-type WITHOUT divergence (remote not newer) → flushed
//       normally.
//   (e) supervisor resolution (`sync-critical-conflict-resolved`) drops
//       the retained local op so it can never replay over the decision.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RiskNode } from '../types';

// --- Mocks (registered BEFORE importing the SUT) ---

const getDocMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  writeBatch: vi.fn(),
  doc: vi.fn((_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` })),
  getDoc: (...args: unknown[]) => getDocMock(...args),
}));

vi.mock('./firebase', () => ({ db: {} }));

const syncBatchMock = vi.fn(async (_ops: unknown[]) => ({ failedOps: [] as Array<{ id: string }> }));
vi.mock('./geminiService', () => ({
  generateEmbeddingsBatch: vi.fn(async () => []),
  syncBatchToNetwork: (...args: unknown[]) =>
    syncBatchMock(...(args as [unknown[]])),
}));

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const apiAuthHeaderMock = vi.fn(async () => 'Bearer test-token');
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: (...args: unknown[]) => apiAuthHeaderMock(...(args as [])),
}));

const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ ok: true }) }));
vi.stubGlobal('fetch', fetchMock);

// --- SUT (singleton, imported after mocks) ---
const { matrixSyncManager } = await import('./syncManager');

const T_BASE = '2026-06-10T10:00:00.000Z';
const T_LOCAL = '2026-06-10T11:00:00.000Z';
const T_PEER = '2026-06-10T12:00:00.000Z'; // peer wrote AFTER our offline edit

const makeNode = (
  id: string,
  type: string,
  overrides: Partial<RiskNode> = {},
): RiskNode =>
  ({
    id,
    type,
    title: 'local edit',
    description: 'desc',
    tags: [],
    metadata: { authorId: 'u1' },
    connections: [],
    projectId: 'proj-1',
    createdAt: T_BASE,
    updatedAt: T_LOCAL,
    ...overrides,
  } as unknown as RiskNode);

const remoteDoc = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});

async function drainQueue() {
  for (const op of matrixSyncManager.getPendingOperations()) {
    await matrixSyncManager.restoreServerVersion('nodes', op.id, {});
  }
}

beforeEach(async () => {
  await drainQueue();
  memStore.clear();
  getDocMock.mockReset();
  syncBatchMock.mockClear();
  syncBatchMock.mockResolvedValue({ failedOps: [] });
  fetchMock.mockClear();
  apiAuthHeaderMock.mockClear();
  apiAuthHeaderMock.mockResolvedValue('Bearer test-token');
});

describe('§16.2.2 — safety-critical doc types never last-write-wins', () => {
  it('(a) double offline edit of the same incident_report: nothing is lost — remote untouched, conflict enqueued + emitted, local op left in conflict state', async () => {
    // Peer edited the same incident node while we were offline.
    getDocMock.mockResolvedValue(
      remoteDoc({
        id: 'inc-1',
        type: 'Incidente',
        title: 'peer edit — severidad corregida',
        description: 'desc',
        projectId: 'proj-1',
        updatedAt: T_PEER,
      }),
    );

    const events: Array<Record<string, unknown>> = [];
    const onConflict = (e: Event) =>
      events.push((e as CustomEvent<Record<string, unknown>>).detail);
    window.addEventListener('sync-critical-conflict', onConflict);

    try {
      await matrixSyncManager.enqueueSet(makeNode('inc-1', 'Incidente'));
      await matrixSyncManager.flush();

      // Remote stays intact: the batch write was NEVER sent.
      expect(syncBatchMock).not.toHaveBeenCalled();

      // The conflict was surfaced in-session (same event OfflineSyncManager
      // emits — ConflictResolutionDrawer consumes it)...
      expect(events).toHaveLength(1);
      const conflict = events[0] as {
        docId: string;
        docType: string;
        collection: string;
        fields: Array<{ field: string; critical: boolean }>;
      };
      expect(conflict.docId).toBe('inc-1');
      expect(conflict.collection).toBe('nodes');
      expect(conflict.docType).toBe('IncidentReport');
      // §16.2.2: EVERY diverging field is critical for these doc types.
      expect(conflict.fields.length).toBeGreaterThan(0);
      expect(conflict.fields.every((f) => f.critical)).toBe(true);

      // ...AND durably posted to the server conflict_queue with auth.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ];
      expect(url).toBe('/api/sprint-k/proj-1/conflict-queue/enqueue');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer test-token');
      const body = JSON.parse(init.body) as { conflict: { docId: string; docType: string } };
      expect(body.conflict.docId).toBe('inc-1');
      expect(body.conflict.docType).toBe('IncidentReport');

      // Local version preserved: the op is RETAINED in the queue, marked
      // as conflicted, awaiting human resolution.
      const conflicted = matrixSyncManager.getConflictedOperations();
      expect(conflicted.map((o) => o.id)).toContain('inc-1');
      expect(
        matrixSyncManager.getPendingOperations().some((o) => o.id === 'inc-1'),
      ).toBe(true);

      // No retry loop: a second flush neither re-reads the remote nor
      // re-sends the conflict.
      getDocMock.mockClear();
      fetchMock.mockClear();
      await matrixSyncManager.flush();
      expect(getDocMock).not.toHaveBeenCalled();
      expect(syncBatchMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
    } finally {
      window.removeEventListener('sync-critical-conflict', onConflict);
    }
  });

  it('(b) non-critical doc type with a newer remote keeps the current behavior: no remote read, batch flushed (no regression)', async () => {
    getDocMock.mockResolvedValue(
      remoteDoc({ id: 'hal-1', type: 'Hallazgo', title: 'peer', updatedAt: T_PEER }),
    );
    const events: unknown[] = [];
    const onConflict = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener('sync-critical-conflict', onConflict);

    try {
      await matrixSyncManager.enqueueSet(makeNode('hal-1', 'Hallazgo'));
      await matrixSyncManager.flush();

      // Non-critical path: zero remote reads, batch sent as before.
      expect(getDocMock).not.toHaveBeenCalled();
      expect(syncBatchMock).toHaveBeenCalledTimes(1);
      const ops = syncBatchMock.mock.calls[0][0] as Array<{ id: string }>;
      expect(ops.map((o) => o.id)).toContain('hal-1');
      // Queue drained on success.
      expect(
        matrixSyncManager.getPendingOperations().some((o) => o.id === 'hal-1'),
      ).toBe(false);
      expect(events).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('sync-critical-conflict', onConflict);
    }
  });

  it('(c) safety doc type WITHOUT divergence (remote not newer than base) flushes normally', async () => {
    // Remote equals our base — the peer has not moved.
    getDocMock.mockResolvedValue(
      remoteDoc({
        id: 'insp-1',
        type: 'Inspección',
        title: 'local edit',
        updatedAt: T_BASE, // older than our local edit timestamp
      }),
    );
    const events: unknown[] = [];
    const onConflict = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener('sync-critical-conflict', onConflict);

    try {
      await matrixSyncManager.enqueueSet(makeNode('insp-1', 'Inspección'));
      await matrixSyncManager.flush();

      expect(syncBatchMock).toHaveBeenCalledTimes(1);
      const ops = syncBatchMock.mock.calls[0][0] as Array<{ id: string }>;
      expect(ops.map((o) => o.id)).toContain('insp-1');
      expect(
        matrixSyncManager.getPendingOperations().some((o) => o.id === 'insp-1'),
      ).toBe(false);
      expect(events).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(matrixSyncManager.getConflictedOperations()).toHaveLength(0);
    } finally {
      window.removeEventListener('sync-critical-conflict', onConflict);
    }
  });

  it('(c-bis) safety doc type with NO remote doc (first sync of a create) flushes normally', async () => {
    getDocMock.mockResolvedValue(remoteDoc(null));

    await matrixSyncManager.enqueueSet(makeNode('emg-1', 'Emergencia'));
    await matrixSyncManager.flush();

    expect(syncBatchMock).toHaveBeenCalledTimes(1);
    expect(
      matrixSyncManager.getPendingOperations().some((o) => o.id === 'emg-1'),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(e) supervisor resolution (sync-critical-conflict-resolved) drops the retained local op so it cannot replay', async () => {
    getDocMock.mockResolvedValue(
      remoteDoc({
        id: 'med-1',
        type: 'Medicina',
        title: 'peer edit',
        projectId: 'proj-1',
        updatedAt: T_PEER,
      }),
    );

    await matrixSyncManager.enqueueSet(makeNode('med-1', 'Medicina'));
    await matrixSyncManager.flush();
    expect(matrixSyncManager.getConflictedOperations().map((o) => o.id)).toContain('med-1');

    window.dispatchEvent(
      new CustomEvent('sync-critical-conflict-resolved', {
        detail: { collection: 'nodes', docId: 'med-1', resolutions: [] },
      }),
    );
    await Promise.resolve();

    expect(matrixSyncManager.getConflictedOperations()).toHaveLength(0);
    expect(
      matrixSyncManager.getPendingOperations().some((o) => o.id === 'med-1'),
    ).toBe(false);
  });
});
