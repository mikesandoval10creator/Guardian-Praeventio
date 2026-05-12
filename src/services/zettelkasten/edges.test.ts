import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildEdge,
  computeEdgeId,
  createEdge,
  deleteEdge,
  getRelatedNodes,
  EdgeValidationError,
  EDGE_INVERSES,
  type EdgeStore,
  type ZkEdge,
  type EdgeType,
} from './edges.js';

// In-memory store para tests — testea el contrato del adapter sin
// arrastrar Firebase Admin.
function buildInMemoryStore(): EdgeStore & { _all(): ZkEdge[] } {
  const byId = new Map<string, ZkEdge>();
  return {
    async saveEdge(edge) {
      byId.set(edge.id, edge);
    },
    async deleteEdgeById(id) {
      byId.delete(id);
    },
    async findOutgoing(nodeId, tenantId, type) {
      return Array.from(byId.values()).filter(
        (e) =>
          e.tenantId === tenantId &&
          e.fromNodeId === nodeId &&
          (!type || e.type === type),
      );
    },
    async findIncoming(nodeId, tenantId, type) {
      return Array.from(byId.values()).filter(
        (e) =>
          e.tenantId === tenantId &&
          e.toNodeId === nodeId &&
          (!type || e.type === type),
      );
    },
    _all: () => Array.from(byId.values()),
  };
}

describe('computeEdgeId', () => {
  it('is deterministic: misma terna → mismo id', () => {
    const a = computeEdgeId('node-A', 'node-B', 'requires');
    const b = computeEdgeId('node-A', 'node-B', 'requires');
    expect(a).toBe(b);
  });

  it('differs across types between same nodes', () => {
    const a = computeEdgeId('node-A', 'node-B', 'requires');
    const b = computeEdgeId('node-A', 'node-B', 'mitigates');
    expect(a).not.toBe(b);
  });

  it('differs across directions', () => {
    const ab = computeEdgeId('node-A', 'node-B', 'requires');
    const ba = computeEdgeId('node-B', 'node-A', 'requires');
    expect(ab).not.toBe(ba);
  });
});

describe('buildEdge', () => {
  it('rejects self-loops', () => {
    expect(() =>
      buildEdge({
        fromNodeId: 'X',
        toNodeId: 'X',
        type: 'requires',
        tenantId: 't',
        createdBy: 'u',
      }),
    ).toThrow(EdgeValidationError);
  });

  it('rejects unknown types', () => {
    expect(() =>
      buildEdge({
        fromNodeId: 'A',
        toNodeId: 'B',
        type: 'not_a_real_type' as any,
        tenantId: 't',
        createdBy: 'u',
      }),
    ).toThrow(EdgeValidationError);
  });

  it('populates inverseType from EDGE_INVERSES', () => {
    const e = buildEdge({
      fromNodeId: 'risk-1',
      toNodeId: 'epp-helmet',
      type: 'requires',
      tenantId: 't',
      createdBy: 'u',
    });
    expect(e.inverseType).toBe(EDGE_INVERSES.requires);
    expect(e.inverseType).toBe('required_by');
  });

  it('every EdgeType has a defined inverse', () => {
    for (const t of [
      'requires',
      'mitigates',
      'references',
      'causes',
      'assigned_to',
      'expires_into',
      'generated_by',
      'documented_by',
      'regulates',
      'derived_from',
    ] as EdgeType[]) {
      const e = buildEdge({
        fromNodeId: 'a',
        toNodeId: 'b',
        type: t,
        tenantId: 't',
        createdBy: 'u',
      });
      expect(e.inverseType).toBeTruthy();
      expect(e.inverseType).not.toBe(t);
    }
  });
});

describe('createEdge + getRelatedNodes', () => {
  let store: ReturnType<typeof buildInMemoryStore>;

  beforeEach(() => {
    store = buildInMemoryStore();
  });

  it('is idempotent: misma terna two veces = un edge', async () => {
    await createEdge(store, {
      fromNodeId: 'risk-1',
      toNodeId: 'epp-helmet',
      type: 'requires',
      tenantId: 't1',
      createdBy: 'u1',
    });
    await createEdge(store, {
      fromNodeId: 'risk-1',
      toNodeId: 'epp-helmet',
      type: 'requires',
      tenantId: 't1',
      createdBy: 'u-other',
    });
    expect(store._all()).toHaveLength(1);
  });

  it('bidireccionalidad: getRelatedNodes(risk) y getRelatedNodes(epp) ambos encuentran el edge', async () => {
    await createEdge(store, {
      fromNodeId: 'risk-1',
      toNodeId: 'epp-helmet',
      type: 'requires',
      tenantId: 't1',
      createdBy: 'u1',
    });

    const fromRisk = await getRelatedNodes(store, 'risk-1', 't1');
    expect(fromRisk).toHaveLength(1);
    expect(fromRisk[0].nodeId).toBe('epp-helmet');
    expect(fromRisk[0].via).toBe('requires');
    expect(fromRisk[0].direction).toBe('outgoing');

    const fromEpp = await getRelatedNodes(store, 'epp-helmet', 't1');
    expect(fromEpp).toHaveLength(1);
    expect(fromEpp[0].nodeId).toBe('risk-1');
    expect(fromEpp[0].via).toBe('required_by');
    expect(fromEpp[0].direction).toBe('incoming');
  });

  it('filtra por viaType', async () => {
    await createEdge(store, {
      fromNodeId: 'risk-1',
      toNodeId: 'epp-helmet',
      type: 'requires',
      tenantId: 't1',
      createdBy: 'u',
    });
    await createEdge(store, {
      fromNodeId: 'risk-1',
      toNodeId: 'control-fence',
      type: 'mitigates',
      tenantId: 't1',
      createdBy: 'u',
    });

    const onlyRequires = await getRelatedNodes(store, 'risk-1', 't1', {
      viaType: 'requires',
      direction: 'outgoing',
    });
    expect(onlyRequires).toHaveLength(1);
    expect(onlyRequires[0].nodeId).toBe('epp-helmet');
  });

  it('isolates tenants: tenant A edge no aparece en tenant B', async () => {
    await createEdge(store, {
      fromNodeId: 'risk-1',
      toNodeId: 'epp-helmet',
      type: 'requires',
      tenantId: 'tenantA',
      createdBy: 'u',
    });
    const fromB = await getRelatedNodes(store, 'risk-1', 'tenantB');
    expect(fromB).toHaveLength(0);
  });

  it('deleteEdge remueve por id content-addressed', async () => {
    await createEdge(store, {
      fromNodeId: 'risk-1',
      toNodeId: 'epp-helmet',
      type: 'requires',
      tenantId: 't1',
      createdBy: 'u',
    });
    expect(store._all()).toHaveLength(1);
    await deleteEdge(store, {
      fromNodeId: 'risk-1',
      toNodeId: 'epp-helmet',
      type: 'requires',
      tenantId: 't1',
    });
    expect(store._all()).toHaveLength(0);
  });

  it('handles multi-hop graph: TASK assigned_to WORKER + WORKER assigned_to PROJECT', async () => {
    await createEdge(store, {
      fromNodeId: 'task-42',
      toNodeId: 'worker-juan',
      type: 'assigned_to',
      tenantId: 't',
      createdBy: 'u',
    });
    await createEdge(store, {
      fromNodeId: 'worker-juan',
      toNodeId: 'project-mina-norte',
      type: 'assigned_to',
      tenantId: 't',
      createdBy: 'u',
    });

    const fromWorker = await getRelatedNodes(store, 'worker-juan', 't');
    // 1 incoming desde task + 1 outgoing al project = 2 totales
    expect(fromWorker).toHaveLength(2);
    expect(fromWorker.find((r) => r.direction === 'incoming')?.nodeId).toBe('task-42');
    expect(fromWorker.find((r) => r.direction === 'outgoing')?.nodeId).toBe('project-mina-norte');
  });
});
