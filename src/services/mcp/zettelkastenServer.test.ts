import { describe, it, expect } from 'vitest';
import {
  handleMcpRequest,
  MCP_TOOLS,
  MCP_RESOURCES,
  ZK_CITATION_POLICY,
  type ZkReadAdapter,
  type ZkNodeRef,
  type HandlerContext,
} from './zettelkastenServer.js';

// ────────────────────────────────────────────────────────────────────────
// In-memory fake adapter
// ────────────────────────────────────────────────────────────────────────

class FakeAdapter implements ZkReadAdapter {
  constructor(private nodes: Map<string, ZkNodeRef> = new Map()) {}

  addNode(n: ZkNodeRef) {
    this.nodes.set(n.id, n);
  }

  async listAccessibleTenants(): Promise<string[]> {
    return Array.from(new Set([...this.nodes.values()].map((n) => n.tenantId ?? '_default')));
  }

  async getNode(tenantId: string, nodeId: string) {
    const n = this.nodes.get(nodeId);
    return n && n.tenantId === tenantId ? n : null;
  }

  async listNodes(tenantId: string, filter: { projectId?: string; type?: string; severity?: string; limit?: number }) {
    return [...this.nodes.values()]
      .filter((n) => n.tenantId === tenantId)
      .filter((n) => !filter.projectId || n.projectId === filter.projectId)
      .filter((n) => !filter.type || n.type === filter.type)
      .filter((n) => !filter.severity || n.severity === filter.severity)
      .slice(0, filter.limit ?? 25);
  }

  async expandSubgraph(tenantId: string, rootNodeId: string, depth: number) {
    const out = new Map<string, ZkNodeRef>();
    const queue: Array<{ id: string; d: number }> = [{ id: rootNodeId, d: 0 }];
    while (queue.length > 0) {
      const item = queue.shift()!;
      const n = await this.getNode(tenantId, item.id);
      if (!n || out.has(n.id)) continue;
      out.set(n.id, n);
      if (item.d < depth) {
        for (const c of n.connections) queue.push({ id: c, d: item.d + 1 });
      }
    }
    return [...out.values()];
  }
}

function buildContext(allowed: string[], adapter: ZkReadAdapter): HandlerContext {
  return {
    allowedTenantIds: new Set(allowed),
    adapter,
  };
}

function buildAdapterWithSample(): FakeAdapter {
  const a = new FakeAdapter();
  a.addNode({
    id: 'n1',
    type: 'Riesgo',
    title: 'Trabajo en altura',
    description: 'Cuadrilla NE',
    tags: ['altura'],
    connections: ['n2', 'n3'],
    severity: 'high',
    projectId: 'p1',
    tenantId: 'tA',
  });
  a.addNode({
    id: 'n2',
    type: 'Control',
    title: 'Línea de vida',
    description: 'Engineering',
    tags: [],
    connections: ['n1'],
    severity: 'info',
    projectId: 'p1',
    tenantId: 'tA',
  });
  a.addNode({
    id: 'n3',
    type: 'EPP',
    title: 'Arnés',
    description: 'PPE certificado',
    tags: [],
    connections: ['n1'],
    severity: 'info',
    projectId: 'p1',
    tenantId: 'tA',
  });
  a.addNode({
    id: 'nX',
    type: 'Riesgo',
    title: 'Otro tenant',
    description: 'no debería ser visible',
    tags: [],
    connections: [],
    projectId: 'p99',
    tenantId: 'tOther',
  });
  return a;
}

describe('MCP zettelkasten server — protocol surface', () => {
  it('initialize devuelve protocolVersion + citation policy', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      ctx,
    );
    expect(res.result).toMatchObject({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'praeventio-zk' },
    });
    expect((res.result as { citationPolicy: string }).citationPolicy).toMatch(/zk:/);
  });

  it('tools/list expone los 3 tools canónicos', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ctx,
    );
    const names = (res.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).toEqual(['zk.getNode', 'zk.listNodes', 'zk.expandSubgraph']);
  });

  it('resources/list incluye zk://tenants', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 3, method: 'resources/list' },
      ctx,
    );
    expect((res.result as { resources: Array<{ uri: string }> }).resources[0].uri).toBe(
      'zk://tenants',
    );
  });

  it('resources/read zk://tenants filtra por allowedTenantIds', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'zk://tenants' } },
      ctx,
    );
    const text = (res.result as { contents: Array<{ text: string }> }).contents[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.tenants).toEqual(['tA']);
  });

  it('método desconocido devuelve METHOD_NOT_FOUND', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      { jsonrpc: '2.0', id: 5, method: 'nonsense' },
      ctx,
    );
    expect(res.error?.code).toBe(-32601);
  });
});

describe('MCP zettelkasten server — tool dispatch', () => {
  it('zk.getNode devuelve nodo + citation', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'zk.getNode', arguments: { tenantId: 'tA', nodeId: 'n1' } },
      },
      ctx,
    );
    const text = ((res.result as { content: Array<{ text: string }> }).content[0]).text;
    const parsed = JSON.parse(text);
    expect(parsed.node.id).toBe('n1');
    expect(parsed.citation).toBe('(zk:n1)');
  });

  it('zk.getNode con tenant NO accesible falla', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'zk.getNode', arguments: { tenantId: 'tOther', nodeId: 'nX' } },
      },
      ctx,
    );
    expect(res.error).toBeDefined();
  });

  it('zk.listNodes filtra por proyecto + type + emite citations', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'zk.listNodes',
          arguments: { tenantId: 'tA', projectId: 'p1', type: 'Control' },
        },
      },
      ctx,
    );
    const parsed = JSON.parse(
      ((res.result as { content: Array<{ text: string }> }).content[0]).text,
    );
    expect(parsed.count).toBe(1);
    expect(parsed.nodes[0].id).toBe('n2');
    expect(parsed.citations).toEqual(['(zk:n2)']);
  });

  it('zk.expandSubgraph BFS limita a depth', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'zk.expandSubgraph',
          arguments: { tenantId: 'tA', rootNodeId: 'n1', depth: 1 },
        },
      },
      ctx,
    );
    const parsed = JSON.parse(
      ((res.result as { content: Array<{ text: string }> }).content[0]).text,
    );
    // depth=1 desde n1 → n1 + n2 + n3
    expect(parsed.count).toBe(3);
  });

  it('zk.expandSubgraph depth clamp [1..3]', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'zk.expandSubgraph',
          arguments: { tenantId: 'tA', rootNodeId: 'n1', depth: 99 },
        },
      },
      ctx,
    );
    const parsed = JSON.parse(
      ((res.result as { content: Array<{ text: string }> }).content[0]).text,
    );
    expect(parsed.depth).toBe(3);
  });

  it('zk.expandSubgraph nodo inexistente → array vacío', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'zk.expandSubgraph',
          arguments: { tenantId: 'tA', rootNodeId: 'no-exist' },
        },
      },
      ctx,
    );
    const parsed = JSON.parse(
      ((res.result as { content: Array<{ text: string }> }).content[0]).text,
    );
    expect(parsed.count).toBe(0);
  });

  it('tools/call con name desconocido falla', async () => {
    const ctx = buildContext(['tA'], buildAdapterWithSample());
    const res = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: { name: 'zk.evilCommand', arguments: {} },
      },
      ctx,
    );
    expect(res.error?.code).toBe(-32602);
  });
});

describe('citation policy export', () => {
  it('contiene reglas críticas: cita id + nunca inventar', () => {
    expect(ZK_CITATION_POLICY).toMatch(/zk:/);
    expect(ZK_CITATION_POLICY).toMatch(/NUNCA inventar/);
  });
});

describe('schema declarations', () => {
  it('MCP_TOOLS son 3', () => {
    expect(MCP_TOOLS).toHaveLength(3);
  });
  it('todas las tools tienen tenantId required', () => {
    for (const t of MCP_TOOLS) {
      expect(t.inputSchema.required).toContain('tenantId');
    }
  });
  it('MCP_RESOURCES tiene 1 resource', () => {
    expect(MCP_RESOURCES).toHaveLength(1);
  });
});
