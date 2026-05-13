import { describe, it, expect } from 'vitest';
import {
  buildZkRagContext,
  extractRagKeywords,
  ZK_RAG_SYSTEM_INSTRUCTIONS,
} from './zkRagContextBuilder.js';
import type { ZkReadAdapter, ZkNodeRef } from '../mcp/zettelkastenServer.js';

// ────────────────────────────────────────────────────────────────────────
// Fake adapter implementing ZkReadAdapter with multi-tenant isolation
// ────────────────────────────────────────────────────────────────────────

class FakeReadAdapter implements ZkReadAdapter {
  constructor(private corpus: Record<string, ZkNodeRef[]>) {}

  async listAccessibleTenants(): Promise<string[]> {
    return Object.keys(this.corpus);
  }

  async getNode(tenantId: string, nodeId: string): Promise<ZkNodeRef | null> {
    const nodes = this.corpus[tenantId] ?? [];
    return nodes.find((n) => n.id === nodeId) ?? null;
  }

  async listNodes(
    tenantId: string,
    filter: { projectId?: string; type?: string; severity?: string; limit?: number },
  ): Promise<ZkNodeRef[]> {
    const nodes = this.corpus[tenantId] ?? [];
    const out = nodes.filter((n) => {
      if (filter.projectId && n.projectId !== filter.projectId) return false;
      if (filter.type && n.type !== filter.type) return false;
      if (filter.severity && n.severity !== filter.severity) return false;
      return true;
    });
    return out.slice(0, filter.limit ?? 50);
  }

  async expandSubgraph(
    tenantId: string,
    rootNodeId: string,
    depth: number,
  ): Promise<ZkNodeRef[]> {
    const nodes = this.corpus[tenantId] ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const visited = new Set<string>([rootNodeId]);
    const queue: Array<{ id: string; d: number }> = [{ id: rootNodeId, d: 0 }];
    const out: ZkNodeRef[] = [];
    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      const n = byId.get(id);
      if (!n) continue;
      if (d > 0) out.push(n); // exclude root
      if (d >= depth) continue;
      for (const c of n.connections) {
        if (visited.has(c)) continue;
        visited.add(c);
        queue.push({ id: c, d: d + 1 });
      }
    }
    return out;
  }
}

class ThrowingAdapter implements ZkReadAdapter {
  async listAccessibleTenants(): Promise<string[]> { return []; }
  async getNode(): Promise<ZkNodeRef | null> { throw new Error('tenant denied'); }
  async listNodes(): Promise<ZkNodeRef[]> { throw new Error('tenant denied'); }
  async expandSubgraph(): Promise<ZkNodeRef[]> { throw new Error('tenant denied'); }
}

// ────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────

function makeNode(partial: Partial<ZkNodeRef> & { id: string }): ZkNodeRef {
  return {
    type: 'Riesgo',
    title: '',
    description: '',
    tags: [],
    connections: [],
    ...partial,
  } as ZkNodeRef;
}

const TENANT_A_NODES: ZkNodeRef[] = [
  makeNode({
    id: 'node-trab-1',
    type: 'Trabajador',
    title: 'Juan operario soldador',
    description: 'Soldador certificado en faena norte',
    tags: ['soldadura', 'norte'],
    connections: ['node-risk-1'],
    projectId: 'proj-norte',
  }),
  makeNode({
    id: 'node-risk-1',
    type: 'Riesgo',
    title: 'Riesgo radiación UV soldadura',
    description: 'Exposición a radiación ultravioleta en proceso de soldadura al arco',
    tags: ['soldadura', 'radiacion'],
    severity: 'alto',
    connections: ['node-trab-1', 'node-epp-1'],
    projectId: 'proj-norte',
  }),
  makeNode({
    id: 'node-epp-1',
    type: 'EPP',
    title: 'Máscara soldar clase E',
    description: 'Máscara de soldar con filtro DIN 11 obligatoria para arc welding',
    tags: ['epp', 'soldadura'],
    connections: ['node-risk-1'],
    projectId: 'proj-norte',
  }),
  makeNode({
    id: 'node-norm-1',
    type: 'Normativa',
    title: 'DS 594 Art 53 iluminación',
    description: 'Normativa chilena de niveles mínimos de iluminación en faenas',
    tags: ['normativa', 'iluminacion'],
    connections: [],
    projectId: 'proj-norte',
  }),
];

const TENANT_B_NODES: ZkNodeRef[] = [
  makeNode({
    id: 'node-other-1',
    type: 'Trabajador',
    title: 'Soldador en tenant distinto',
    description: 'No debe leakear a tenant A',
    tags: ['soldadura'],
    connections: [],
    projectId: 'proj-sur',
  }),
];

// ────────────────────────────────────────────────────────────────────────
// extractRagKeywords
// ────────────────────────────────────────────────────────────────────────

describe('extractRagKeywords', () => {
  it('strips stopwords and short tokens', () => {
    const kws = extractRagKeywords('¿Qué EPP necesita el soldador para la radiación UV?');
    expect(kws).toContain('epp');
    expect(kws).toContain('soldador');
    expect(kws).toContain('radiacion');
    expect(kws).not.toContain('el');
    expect(kws).not.toContain('la');
    expect(kws).not.toContain('qué');
  });

  it('returns empty for stopword-only or empty queries', () => {
    expect(extractRagKeywords('¿qué de la?')).toEqual([]);
    expect(extractRagKeywords('')).toEqual([]);
  });

  it('dedupes and caps to maxKeywords', () => {
    const kws = extractRagKeywords('soldador soldador soldador epp epp riesgo riesgo control normativa hallazgo incidente cuadrilla');
    expect(new Set(kws).size).toBe(kws.length);
    expect(kws.length).toBeLessThanOrEqual(8);
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildZkRagContext
// ────────────────────────────────────────────────────────────────────────

describe('buildZkRagContext', () => {
  it('returns relevant nodes when keywords match (worker → risk → EPP chain)', async () => {
    const adapter = new FakeReadAdapter({ 'tenant-a': TENANT_A_NODES });
    const ctx = await buildZkRagContext(
      {
        question: '¿Qué EPP necesita el soldador para el riesgo de radiación UV?',
        tenantId: 'tenant-a',
        contextProjectId: 'proj-norte',
      },
      adapter,
    );
    expect(ctx.isEmpty).toBe(false);
    expect(ctx.relevantNodes.length).toBeGreaterThanOrEqual(2);
    const ids = ctx.relevantNodes.map((n) => n.id);
    // Both the worker (keyword "soldador") and the risk (keyword "radiacion")
    // should appear as seeds; the EPP should arrive via BFS expansion.
    expect(ids).toContain('node-risk-1');
    expect(ids).toContain('node-epp-1');
    expect(ctx.groundingNodeIds.has('node-risk-1')).toBe(true);
  });

  it('returns empty context when no keywords match', async () => {
    const adapter = new FakeReadAdapter({ 'tenant-a': TENANT_A_NODES });
    const ctx = await buildZkRagContext(
      {
        question: '¿Cómo se prepara una torta de cumpleaños?',
        tenantId: 'tenant-a',
      },
      adapter,
    );
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.relevantNodes).toHaveLength(0);
    expect(ctx.groundingNodeIds.size).toBe(0);
    expect(ctx.promptContext).toContain('no tengo info en el grafo del tenant');
  });

  it('respects BFS depth cap', async () => {
    // Build chain: A -> B -> C -> D, request depth=1 from A.
    const corpus: ZkNodeRef[] = [
      makeNode({ id: 'chain-a', type: 'Riesgo', title: 'soldadura riesgo a',
        description: 'root', tags: [], connections: ['chain-b'] }),
      makeNode({ id: 'chain-b', type: 'Riesgo', title: 'b', description: 'b', tags: [], connections: ['chain-c'] }),
      makeNode({ id: 'chain-c', type: 'Riesgo', title: 'c', description: 'c', tags: [], connections: ['chain-d'] }),
      makeNode({ id: 'chain-d', type: 'Riesgo', title: 'd', description: 'd', tags: [], connections: [] }),
    ];
    const adapter = new FakeReadAdapter({ 'tenant-a': corpus });
    const ctx = await buildZkRagContext(
      {
        question: 'soldadura riesgo',
        tenantId: 'tenant-a',
        maxDepth: 1,
        maxNodes: 10,
      },
      adapter,
    );
    const ids = ctx.relevantNodes.map((n) => n.id);
    expect(ids).toContain('chain-a');
    expect(ids).toContain('chain-b');
    // depth=1 from A should NOT include C or D.
    expect(ids).not.toContain('chain-c');
    expect(ids).not.toContain('chain-d');
  });

  it('caps to maxNodes', async () => {
    const many: ZkNodeRef[] = Array.from({ length: 30 }, (_, i) =>
      makeNode({
        id: `bulk-${i}`,
        type: 'Riesgo',
        title: 'soldadura masiva',
        description: `nodo bulk ${i}`,
        tags: [],
        connections: [],
      }),
    );
    const adapter = new FakeReadAdapter({ 'tenant-a': many });
    const ctx = await buildZkRagContext(
      { question: 'soldadura', tenantId: 'tenant-a', maxNodes: 5 },
      adapter,
    );
    expect(ctx.relevantNodes.length).toBeLessThanOrEqual(5);
  });

  it('enforces multi-tenant isolation — tenant-a never sees tenant-b nodes', async () => {
    const adapter = new FakeReadAdapter({
      'tenant-a': TENANT_A_NODES,
      'tenant-b': TENANT_B_NODES,
    });
    const ctx = await buildZkRagContext(
      { question: 'soldador', tenantId: 'tenant-a' },
      adapter,
    );
    const ids = ctx.relevantNodes.map((n) => n.id);
    expect(ids).not.toContain('node-other-1');
    // And the other direction.
    const ctxB = await buildZkRagContext(
      { question: 'soldador', tenantId: 'tenant-b' },
      adapter,
    );
    const idsB = ctxB.relevantNodes.map((n) => n.id);
    expect(idsB).toContain('node-other-1');
    expect(idsB).not.toContain('node-trab-1');
  });

  it('returns empty (not throws) when adapter denies tenant access', async () => {
    const adapter = new ThrowingAdapter();
    const ctx = await buildZkRagContext(
      { question: 'soldador', tenantId: 'forbidden' },
      adapter,
    );
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.relevantNodes).toHaveLength(0);
  });

  it('returns empty when tenantId is missing', async () => {
    const adapter = new FakeReadAdapter({ 'tenant-a': TENANT_A_NODES });
    const ctx = await buildZkRagContext(
      { question: 'soldador', tenantId: '' as string },
      adapter,
    );
    expect(ctx.isEmpty).toBe(true);
  });

  it('promptContext includes citation policy + node lines + tenant meta', async () => {
    const adapter = new FakeReadAdapter({ 'tenant-a': TENANT_A_NODES });
    const ctx = await buildZkRagContext(
      {
        question: 'soldador radiación',
        tenantId: 'tenant-a',
        contextProjectId: 'proj-norte',
      },
      adapter,
    );
    expect(ctx.systemInstructions).toBe(ZK_RAG_SYSTEM_INSTRUCTIONS.trim());
    expect(ctx.promptContext).toContain('[TENANT: tenant-a');
    expect(ctx.promptContext).toContain('PROYECTO: proj-norte');
    expect(ctx.promptContext).toMatch(/\[node-risk-1\]/);
    expect(ctx.promptContext).toContain('[NODOS RELEVANTES');
  });

  it('contextUid seeds the BFS even if no keyword match', async () => {
    const adapter = new FakeReadAdapter({ 'tenant-a': TENANT_A_NODES });
    const ctx = await buildZkRagContext(
      {
        question: 'iluminacion',
        tenantId: 'tenant-a',
        contextUid: 'node-trab-1',
      },
      adapter,
    );
    const ids = ctx.relevantNodes.map((n) => n.id);
    // node-norm-1 matched by keyword "iluminacion", node-trab-1 seeded via uid.
    expect(ids).toContain('node-trab-1');
    expect(ids).toContain('node-norm-1');
  });

  it('description is truncated when too long', async () => {
    const long = 'x'.repeat(500);
    const corpus = [
      makeNode({
        id: 'long-node-1',
        type: 'Riesgo',
        title: 'soldadura largo',
        description: long,
        tags: [],
        connections: [],
      }),
    ];
    const adapter = new FakeReadAdapter({ 'tenant-a': corpus });
    const ctx = await buildZkRagContext(
      { question: 'soldadura', tenantId: 'tenant-a' },
      adapter,
    );
    const n = ctx.relevantNodes.find((x) => x.id === 'long-node-1');
    expect(n).toBeDefined();
    expect(n!.description.length).toBeLessThan(long.length);
    expect(n!.description.endsWith('…')).toBe(true);
  });

  it('groundingNodeIds matches exactly the relevantNodes ids', async () => {
    const adapter = new FakeReadAdapter({ 'tenant-a': TENANT_A_NODES });
    const ctx = await buildZkRagContext(
      { question: 'soldador radiacion', tenantId: 'tenant-a' },
      adapter,
    );
    const idsFromNodes = new Set(ctx.relevantNodes.map((n) => n.id));
    expect(ctx.groundingNodeIds.size).toBe(idsFromNodes.size);
    for (const id of idsFromNodes) {
      expect(ctx.groundingNodeIds.has(id)).toBe(true);
    }
  });
});
