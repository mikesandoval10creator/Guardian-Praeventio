// Alpha41 ZK-8 — consultas estructuradas sobre el grafo (sin LLM).
//
// Cubre el parser cypher-lite y el ejecutor local sobre getRelatedNodes,
// con el in-memory EdgeStore ya usado en edges.test.ts.

import { describe, it, expect } from 'vitest';
import { createEdge, type EdgeStore, type ZkEdge } from './edges.js';
import {
  parsePatternQuery,
  runStructuredQuery,
  GraphQueryParseError,
  type QueryableNode,
} from './structuredQuery.js';

// In-memory store para tests — mismo contrato que edges.test.ts, sin
// arrastrar Firebase Admin. La clave incluye el tenant porque el edgeId
// content-addressed NO lo incluye y en Firestore real cada tenant tiene
// su propia colección (`tenants/{tenantId}/zettelkasten_edges/{edgeId}`).
function buildInMemoryStore(): EdgeStore {
  const byId = new Map<string, ZkEdge>();
  return {
    async saveEdge(edge) {
      byId.set(`${edge.tenantId}|${edge.id}`, edge);
    },
    async deleteEdgeById(id, tenantId) {
      byId.delete(`${tenantId}|${id}`);
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
  };
}

const TENANT = 'tenant-1';

function node(
  id: string,
  type: string,
  metadata: Record<string, unknown> = {},
): QueryableNode {
  return { id, type, metadata };
}

describe('parsePatternQuery', () => {
  it('parses the canonical audit query with unqualified WHERE applied to the target', () => {
    const q = parsePatternQuery(
      '(:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical',
    );
    expect(q.from.type).toBe('Control');
    expect(q.edge).toEqual({ type: 'mitigates', direction: 'outgoing' });
    expect(q.to.type).toBe('Riesgo');
    expect(q.where).toEqual([
      { target: 'to', field: 'severity', op: 'eq', value: 'critical' },
    ]);
  });

  it('parses incoming direction (<-[:causes]-)', () => {
    const q = parsePatternQuery('(:Incidente)<-[:causes]-(:Riesgo)');
    expect(q.edge).toEqual({ type: 'causes', direction: 'incoming' });
    expect(q.where).toEqual([]);
  });

  it('parses undirected pattern as both directions and empty node patterns as wildcards', () => {
    const q = parsePatternQuery('()-[:references]-()');
    expect(q.edge).toEqual({ type: 'references', direction: 'both' });
    expect(q.from.type).toBeUndefined();
    expect(q.to.type).toBeUndefined();
  });

  it('parses qualified from./to. clauses, AND chaining, operators and typed values', () => {
    const q = parsePatternQuery(
      "(:Control)-[:mitigates]->(:Riesgo) WHERE from.status='activo' AND to.probability>=0.5 AND to.residual!=true",
    );
    expect(q.where).toEqual([
      { target: 'from', field: 'status', op: 'eq', value: 'activo' },
      { target: 'to', field: 'probability', op: 'gte', value: 0.5 },
      { target: 'to', field: 'residual', op: 'neq', value: true },
    ]);
  });

  it('rejects edge types outside EDGE_TYPES', () => {
    expect(() => parsePatternQuery('(:A)-[:explota]->(:B)')).toThrow(
      GraphQueryParseError,
    );
  });

  it('rejects malformed patterns', () => {
    expect(() => parsePatternQuery('Control mitigates Riesgo')).toThrow(
      GraphQueryParseError,
    );
    expect(() =>
      parsePatternQuery('(:A)-[:mitigates]->(:B) WHERE severity'),
    ).toThrow(GraphQueryParseError);
  });
});

describe('runStructuredQuery', () => {
  async function seedGraph(store: EdgeStore) {
    // c1 mitiga r1 (critical), c2 mitiga r2 (low), r1 causa i1.
    await createEdge(store, {
      fromNodeId: 'c1',
      toNodeId: 'r1',
      type: 'mitigates',
      tenantId: TENANT,
      createdBy: 'test',
    });
    await createEdge(store, {
      fromNodeId: 'c2',
      toNodeId: 'r2',
      type: 'mitigates',
      tenantId: TENANT,
      createdBy: 'test',
    });
    await createEdge(store, {
      fromNodeId: 'r1',
      toNodeId: 'i1',
      type: 'causes',
      tenantId: TENANT,
      createdBy: 'test',
    });
    // Mismo par en OTRO tenant — jamás debe filtrarse.
    await createEdge(store, {
      fromNodeId: 'c1',
      toNodeId: 'r1',
      type: 'mitigates',
      tenantId: 'tenant-2',
      createdBy: 'test',
    });
  }

  const nodes: QueryableNode[] = [
    node('c1', 'Control', { status: 'activo' }),
    node('c2', 'Control', { status: 'vencido' }),
    node('r1', 'Riesgo', { severity: 'critical', probability: 0.8 }),
    node('r2', 'Riesgo', { severity: 'low', probability: 0.1 }),
    node('i1', 'Incidente', {}),
  ];

  it('answers the canonical audit query: controls mitigating critical risks', async () => {
    const store = buildInMemoryStore();
    await seedGraph(store);
    const matches = await runStructuredQuery(
      store,
      nodes,
      parsePatternQuery('(:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical'),
      TENANT,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].from.id).toBe('c1');
    expect(matches[0].to.id).toBe('r1');
    expect(matches[0].via).toBe('mitigates');
    expect(matches[0].direction).toBe('outgoing');
  });

  it('filters on the FROM side too', async () => {
    const store = buildInMemoryStore();
    await seedGraph(store);
    const matches = await runStructuredQuery(
      store,
      nodes,
      parsePatternQuery(
        "(:Control)-[:mitigates]->(:Riesgo) WHERE from.status='vencido'",
      ),
      TENANT,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].from.id).toBe('c2');
  });

  it('traverses incoming edges: which risks cause this incident', async () => {
    const store = buildInMemoryStore();
    await seedGraph(store);
    const matches = await runStructuredQuery(
      store,
      nodes,
      parsePatternQuery('(:Incidente)<-[:causes]-(:Riesgo)'),
      TENANT,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].from.id).toBe('i1');
    expect(matches[0].to.id).toBe('r1');
    expect(matches[0].direction).toBe('incoming');
  });

  it('orders severity semantically (severity>=high matches critical, not low)', async () => {
    const store = buildInMemoryStore();
    await seedGraph(store);
    const matches = await runStructuredQuery(
      store,
      nodes,
      parsePatternQuery('(:Control)-[:mitigates]->(:Riesgo) WHERE severity>=high'),
      TENANT,
    );
    expect(matches.map((m) => m.to.id)).toEqual(['r1']);
  });

  it('never leaks edges from another tenant', async () => {
    const store = buildInMemoryStore();
    await seedGraph(store);
    const matches = await runStructuredQuery(
      store,
      nodes,
      parsePatternQuery('(:Control)-[:mitigates]->(:Riesgo)'),
      'tenant-3',
    );
    expect(matches).toHaveLength(0);
  });

  it('ignores edges pointing at nodes missing from the local set (dangling)', async () => {
    const store = buildInMemoryStore();
    await createEdge(store, {
      fromNodeId: 'c1',
      toNodeId: 'ghost',
      type: 'mitigates',
      tenantId: TENANT,
      createdBy: 'test',
    });
    const matches = await runStructuredQuery(
      store,
      nodes,
      parsePatternQuery('(:Control)-[:mitigates]->()'),
      TENANT,
    );
    expect(matches).toHaveLength(0);
  });

  it('deduplicates the two perspectives of one edge on undirected queries', async () => {
    const store = buildInMemoryStore();
    await seedGraph(store);
    const matches = await runStructuredQuery(
      store,
      nodes,
      parsePatternQuery('()-[:mitigates]-()'),
      TENANT,
    );
    // 2 edges canónicos → cada uno visto desde sus dos extremos = 4 bindings,
    // pero cada (edge, binding-from) es único: no debe haber repetidos exactos.
    const keys = matches.map((m) => `${m.edge.id}|${m.from.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(matches).toHaveLength(4);
  });

  it('honors limit', async () => {
    const store = buildInMemoryStore();
    await seedGraph(store);
    const q = parsePatternQuery('(:Control)-[:mitigates]->(:Riesgo)');
    const matches = await runStructuredQuery(store, nodes, { ...q, limit: 1 }, TENANT);
    expect(matches).toHaveLength(1);
  });

  it('reads WHERE fields from top-level props as fallback to metadata', async () => {
    const store = buildInMemoryStore();
    await createEdge(store, {
      fromNodeId: 'c1',
      toNodeId: 'rTop',
      type: 'mitigates',
      tenantId: TENANT,
      createdBy: 'test',
    });
    const withTopLevel: QueryableNode[] = [
      node('c1', 'Control'),
      { id: 'rTop', type: 'Riesgo', severity: 'critical' },
    ];
    const matches = await runStructuredQuery(
      store,
      withTopLevel,
      parsePatternQuery('(:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical'),
      TENANT,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].to.id).toBe('rTop');
  });
});
