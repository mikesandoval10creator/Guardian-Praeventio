// @vitest-environment jsdom
//
// Tests for the core risk-graph hook. It owns the `nodes` collection used
// across Risk Network, Audits, Man Down (addNode), etc. We cover the pure
// merge/search/graph logic + the offline-queue mutators (addNode, addConnection,
// updateNode w/ conflict detection, deleteNode cascade) by driving the
// Firestore onSnapshot callback directly and asserting the syncManager calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  onNext: null as ((snap: unknown) => void) | null,
  onErr: null as ((err: unknown) => void) | null,
  authReady: true,
  user: { uid: 'u1' } as { uid: string } | null,
  project: { id: 'p1' } as { id: string } | null,
  pendingActions: [] as unknown[],
  syncOps: [] as unknown[],
  sync: {
    subscribe: vi.fn((_cb?: () => void): (() => void) => () => {}),
    getPendingOperations: vi.fn((): unknown[] => []),
    setNodesProvider: vi.fn((_fn?: unknown): void => {}),
    enqueueSet: vi.fn((_n?: unknown): void => {}),
    enqueueUpdate: vi.fn((_id?: string, _d?: unknown): void => {}),
    enqueueDelete: vi.fn((_id?: string): void => {}),
  },
  enrichNodeData: vi.fn(async (n: unknown) => n),
  generateEmbeddingsBatch: vi.fn(async (_t?: unknown) => [[] as number[]]),
  handleFirestoreError: vi.fn(),
}));

vi.mock('../services/firebase', () => ({
  db: {},
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  onSnapshot: vi.fn((_q: unknown, onNext: (s: unknown) => void, onErr: (e: unknown) => void) => {
    h.onNext = onNext;
    h.onErr = onErr;
    return () => {};
  }),
  handleFirestoreError: (...a: unknown[]) => h.handleFirestoreError(...a),
  OperationType: { LIST: 'LIST', CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ isAuthReady: h.authReady, user: h.user }),
}));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: h.project }) }));
vi.mock('./useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('./usePendingActions', () => ({ usePendingActions: () => h.pendingActions }));
vi.mock('../services/syncManager', () => ({
  matrixSyncManager: {
    subscribe: (cb: () => void) => h.sync.subscribe(cb),
    getPendingOperations: () => h.sync.getPendingOperations(),
    setNodesProvider: (fn: unknown) => h.sync.setNodesProvider(fn),
    enqueueSet: (n: unknown) => h.sync.enqueueSet(n),
    enqueueUpdate: (id: string, d: unknown) => h.sync.enqueueUpdate(id, d),
    enqueueDelete: (id: string) => h.sync.enqueueDelete(id),
  },
}));
vi.mock('../services/geminiService', () => ({
  enrichNodeData: (n: unknown) => h.enrichNodeData(n),
  generateEmbeddingsBatch: (t: unknown) => h.generateEmbeddingsBatch(t),
  autoConnectNodes: vi.fn(),
}));

import { useRiskEngine } from './useRiskEngine';
import { NodeType } from '../types';

function docOf(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}
function emitSnapshot(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  act(() => {
    h.onNext?.({ docs });
  });
}

beforeEach(() => {
  h.onNext = null;
  h.onErr = null;
  h.authReady = true;
  h.user = { uid: 'u1' };
  h.project = { id: 'p1' };
  h.pendingActions = [];
  h.syncOps = [];
  h.sync.subscribe.mockReset().mockReturnValue(() => {});
  h.sync.getPendingOperations.mockReset().mockReturnValue([]);
  h.sync.setNodesProvider.mockReset();
  h.sync.enqueueSet.mockReset();
  h.sync.enqueueUpdate.mockReset();
  h.sync.enqueueDelete.mockReset();
  h.enrichNodeData.mockReset().mockImplementation(async (n: unknown) => n);
  h.generateEmbeddingsBatch.mockReset().mockResolvedValue([[]]);
  h.handleFirestoreError.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useRiskEngine — subscription', () => {
  it('starts loading, then resolves with mapped nodes (description falls back to content)', () => {
    const { result } = renderHook(() => useRiskEngine());
    expect(result.current.loading).toBe(true);
    emitSnapshot([
      docOf('n1', { title: 'Riesgo A', description: 'desc', connections: [], tags: [], updatedAt: '2026-01-02' }),
      docOf('n2', { title: 'Riesgo B', content: 'from-content', connections: [], tags: [], updatedAt: '2026-01-01' }),
    ]);
    expect(result.current.loading).toBe(false);
    expect(result.current.nodes).toHaveLength(2);
    const n2 = result.current.nodes.find((n) => n.id === 'n2');
    expect(n2?.description).toBe('from-content');
  });

  it('empties + stops loading when there is no user/project', () => {
    h.user = null;
    const { result } = renderHook(() => useRiskEngine());
    expect(result.current.loading).toBe(false);
    expect(result.current.nodes).toEqual([]);
  });

  it('surfaces a subscription error to consumers', () => {
    const { result } = renderHook(() => useRiskEngine());
    act(() => {
      h.onErr?.(new Error('permission-denied'));
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(h.handleFirestoreError).toHaveBeenCalled();
  });
});

describe('useRiskEngine — queries', () => {
  it('searchNodes matches title, description, and tags (case-insensitive)', () => {
    const { result } = renderHook(() => useRiskEngine());
    emitSnapshot([
      docOf('n1', { title: 'Caída de altura', description: '', connections: [], tags: ['altura'], updatedAt: '3' }),
      docOf('n2', { title: 'Ruido', description: 'PREXOR', connections: [], tags: [], updatedAt: '2' }),
    ]);
    expect(result.current.searchNodes('ALTURA').map((n) => n.id)).toEqual(['n1']);
    expect(result.current.searchNodes('prexor').map((n) => n.id)).toEqual(['n2']);
    expect(result.current.searchNodes('')).toHaveLength(2);
  });

  it('getGraphData builds de-duplicated links from connections', () => {
    const { result } = renderHook(() => useRiskEngine());
    emitSnapshot([
      docOf('a', { title: 'A', connections: ['b'], tags: [], updatedAt: '2' }),
      docOf('b', { title: 'B', connections: ['a'], tags: [], updatedAt: '1' }),
    ]);
    const g = result.current.getGraphData();
    expect(g.nodes).toHaveLength(2);
    // a↔b is a single undirected link, not two.
    expect(g.links).toHaveLength(1);
    expect(g.nodes[0]).toHaveProperty('name');
  });

  it('getConnectedNodes returns the neighbors of a node', () => {
    const { result } = renderHook(() => useRiskEngine());
    emitSnapshot([
      docOf('a', { title: 'A', connections: ['b'], tags: [], updatedAt: '2' }),
      docOf('b', { title: 'B', connections: ['a'], tags: [], updatedAt: '1' }),
      docOf('c', { title: 'C', connections: [], tags: [], updatedAt: '0' }),
    ]);
    expect(result.current.getConnectedNodes('a').map((n) => n.id)).toEqual(['b']);
  });
});

describe('useRiskEngine — mutators (offline queue)', () => {
  it('addNode enqueues a set with a generated id + timestamps and returns the node', async () => {
    const { result } = renderHook(() => useRiskEngine());
    emitSnapshot([]);
    let created: unknown;
    await act(async () => {
      created = await result.current.addNode({
        type: NodeType.RISK,
        title: 'Nuevo riesgo',
        description: 'algo',
        tags: ['x'],
        connections: [],
      } as never);
    });
    expect(h.sync.enqueueSet).toHaveBeenCalledTimes(1);
    const enqueued = h.sync.enqueueSet.mock.calls[0]![0] as { id: string; createdAt: string };
    expect(enqueued.id).toBeTruthy();
    expect(enqueued.createdAt).toBeTruthy();
    expect((created as { title: string }).title).toBe('Nuevo riesgo');
  });

  it('addNode asks AI to enrich when the title is missing', async () => {
    h.enrichNodeData.mockResolvedValue({ title: 'AI título', description: 'AI desc', tags: [], connections: [] });
    const { result } = renderHook(() => useRiskEngine());
    emitSnapshot([]);
    await act(async () => {
      await result.current.addNode({ type: NodeType.RISK, title: '', description: '', tags: [], connections: [] } as never);
    });
    expect(h.enrichNodeData).toHaveBeenCalledTimes(1);
  });

  it('addNode returns null with no authenticated user', async () => {
    h.user = null;
    const { result } = renderHook(() => useRiskEngine());
    let out: unknown = 'sentinel';
    await act(async () => {
      out = await result.current.addNode({ type: NodeType.RISK, title: 'x', description: 'y', tags: [], connections: [] } as never);
    });
    expect(out).toBeNull();
    expect(h.sync.enqueueSet).not.toHaveBeenCalled();
  });

  it('addConnection links both nodes (bidirectional)', async () => {
    const { result } = renderHook(() => useRiskEngine());
    emitSnapshot([
      docOf('a', { title: 'A', connections: [], tags: [], updatedAt: '2' }),
      docOf('b', { title: 'B', connections: [], tags: [], updatedAt: '1' }),
    ]);
    await act(async () => {
      await result.current.addConnection('a', 'b');
    });
    expect(h.sync.enqueueUpdate).toHaveBeenCalledTimes(2);
  });

  it('deleteNode cascades: scrubs the id from neighbors then enqueues the delete', async () => {
    const { result } = renderHook(() => useRiskEngine());
    emitSnapshot([
      docOf('a', { title: 'A', connections: ['b'], tags: [], updatedAt: '2' }),
      docOf('b', { title: 'B', connections: ['a'], tags: [], updatedAt: '1' }),
    ]);
    await act(async () => {
      await result.current.deleteNode('a');
    });
    // neighbor b gets its connection scrubbed...
    expect(h.sync.enqueueUpdate).toHaveBeenCalledWith('b', expect.objectContaining({ connections: [] }));
    // ...then a is deleted.
    expect(h.sync.enqueueDelete).toHaveBeenCalledWith('a');
  });

  it('updateNode dispatches a sync-conflict event on a stale expectedUpdatedAt', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result } = renderHook(() => useRiskEngine());
    emitSnapshot([docOf('a', { title: 'A', connections: [], tags: [], updatedAt: 'SERVER-TS' })]);
    await act(async () => {
      await result.current.updateNode('a', { title: 'edit' }, 'OLD-TS');
    });
    expect(dispatchSpy).toHaveBeenCalled();
    const evt = dispatchSpy.mock.calls.find((c) => (c[0] as CustomEvent).type === 'sync-conflict');
    expect(evt).toBeTruthy();
    // LWW still applies the update.
    expect(h.sync.enqueueUpdate).toHaveBeenCalledWith('a', expect.objectContaining({ title: 'edit' }));
    dispatchSpy.mockRestore();
  });
});
