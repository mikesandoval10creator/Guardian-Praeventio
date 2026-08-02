import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  enqueue: vi.fn(async () => 'op-1'),
  apiAuthHeader: vi.fn(async (): Promise<string | null> => 'Bearer token'),
  randomId: vi.fn(() => 'node-uuid-1'),
}));

vi.mock('../sync/syncStateMachine', () => ({
  offlineSync: { enqueue: H.enqueue },
}));
vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: H.apiAuthHeader,
}));
vi.mock('../../utils/randomId', () => ({
  randomId: H.randomId,
}));

import {
  connectGraphNodes,
  createGraphNode,
  enqueueGraphNode,
  executeGraphSyncOperation,
  migrateGraphNodes,
  ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
} from './graphMutations';

const node = {
  type: 'Riesgo',
  title: 'Caída de altura',
  description: 'Borde sin protección',
  tags: ['altura'],
  metadata: { probability: 4 },
  connections: [],
  createdAt: '2000-01-01T00:00:00.000Z',
  updatedAt: '2000-01-01T00:00:00.000Z',
};

beforeEach(() => {
  H.enqueue.mockReset().mockResolvedValue('op-1');
  H.apiAuthHeader.mockReset().mockResolvedValue('Bearer token');
  H.randomId.mockReset().mockReturnValue('node-uuid-1');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    text: vi.fn(async () => ''),
  })));
});

describe('Universal Knowledge graph mutation queue', () => {
  it('createGraphNode assigns one stable node id and queues a server mutation', async () => {
    await expect(createGraphNode(node as never, 'p1')).resolves.toBe('node-uuid-1');
    expect(H.enqueue).toHaveBeenCalledWith({
      type: 'set',
      collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
      data: {
        id: 'node:node-uuid-1',
        endpoint: '/api/zettelkasten/graph/nodes',
        body: { projectId: 'p1', nodeId: 'node-uuid-1', node },
      },
    });
  });

  it('enqueueGraphNode preserves a preallocated id for legacy offline replay', async () => {
    await enqueueGraphNode(node as never, 'p1', 'stable-derived-id');
    expect(H.enqueue).toHaveBeenCalledWith({
      type: 'set',
      collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
      data: {
        id: 'node:stable-derived-id',
        endpoint: '/api/zettelkasten/graph/nodes',
        body: { projectId: 'p1', nodeId: 'stable-derived-id', node },
      },
    });
  });

  it('migrateGraphNodes queues only node ids, never client-supplied migration data', async () => {
    await migrateGraphNodes(['b', 'a', 'a'], 'p1');
    expect(H.enqueue).toHaveBeenCalledWith({
      type: 'set',
      collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
      data: {
        id: 'migration:p1:a,b',
        endpoint: '/api/zettelkasten/graph/migrations',
        body: { projectId: 'p1', nodeIds: ['a', 'b'] },
      },
    });
  });

  it('connectGraphNodes canonicalizes the pair so retries dedupe', async () => {
    await connectGraphNodes('z-node', 'a-node', 'p1');
    expect(H.enqueue).toHaveBeenCalledWith({
      type: 'set',
      collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
      data: {
        id: 'connection:p1:a-node:z-node',
        endpoint: '/api/zettelkasten/graph/connections',
        body: { projectId: 'p1', fromId: 'z-node', toId: 'a-node' },
      },
    });
  });
});

describe('executeGraphSyncOperation', () => {
  it('sends the queued operation with current auth at drain time', async () => {
    await executeGraphSyncOperation({
      id: 'op-1', attempts: 0, createdAt: 1, type: 'set',
      collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
      data: {
        id: 'node:node-1',
        endpoint: '/api/zettelkasten/graph/nodes',
        body: { projectId: 'p1', nodeId: 'node-1', node },
      },
    });
    expect(fetch).toHaveBeenCalledWith('/api/zettelkasten/graph/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ projectId: 'p1', nodeId: 'node-1', node }),
    });
  });

  it('rejects untrusted endpoints instead of turning the queue into an arbitrary fetch primitive', async () => {
    await expect(executeGraphSyncOperation({
      id: 'op-1', attempts: 0, createdAt: 1, type: 'set',
      collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
      data: { id: 'x', endpoint: 'https://attacker.example/steal', body: {} },
    })).rejects.toThrow('unsupported graph mutation endpoint');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the operation queued when auth is unavailable or the server rejects it', async () => {
    H.apiAuthHeader.mockResolvedValueOnce(null);
    await expect(executeGraphSyncOperation({
      id: 'op-1', attempts: 0, createdAt: 1, type: 'set',
      collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
      data: { id: 'x', endpoint: '/api/zettelkasten/graph/migrations', body: {} },
    })).rejects.toThrow('authentication unavailable');

    H.apiAuthHeader.mockResolvedValueOnce('Bearer token');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: vi.fn(async () => 'forbidden'),
    } as unknown as Response);
    await expect(executeGraphSyncOperation({
      id: 'op-2', attempts: 0, createdAt: 1, type: 'set',
      collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
      data: { id: 'y', endpoint: '/api/zettelkasten/graph/migrations', body: {} },
    })).rejects.toThrow('graph mutation failed (403)');
  });
});
