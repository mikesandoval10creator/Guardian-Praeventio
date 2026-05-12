// Praeventio Guard — Sprint 39 Fase D.11: MCP Zettelkasten server.
//
// Cierra: Plan Fase D.11 "MCP exponer Zettelkasten".
//
// Implementa el lado SERVIDOR de un Model Context Protocol (MCP) que
// expone el Zettelkasten del proyecto a clientes LLM externos (Claude
// Desktop, Gemini CLI, ChatGPT MCP, etc.). Read-only por política
// estricta — el grafo NO se modifica desde clientes externos.
//
// Para mantener bundle independiente y testeable sin la dependencia
// `@modelcontextprotocol/sdk` (opt-in cuando se autorice), el server
// expone:
//
//   - JSON-RPC handlers puros (función pura request → response).
//   - Schema declarativo de tools + resources que el adaptador SDK
//     puede mapear.
//
// El adaptador `mcpStdioAdapter.ts` (no incluido aún) leerá stdin
// JSON-RPC y delegará a estos handlers. Eso permite shipping del
// motor SIN agregar la dep hoy.

// ────────────────────────────────────────────────────────────────────────
// MCP types (subset, alineado con SDK 2024-11-05)
// ────────────────────────────────────────────────────────────────────────

export interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// ────────────────────────────────────────────────────────────────────────
// Data adapter — el caller inyecta el read-only ZK
// ────────────────────────────────────────────────────────────────────────

export interface ZkNodeRef {
  id: string;
  type: string;
  title: string;
  description: string;
  tags: string[];
  connections: string[];
  severity?: string;
  projectId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface ZkReadAdapter {
  /** Lista de tenants accesibles para el caller (filtrado upstream). */
  listAccessibleTenants(): Promise<string[]>;
  /** Devuelve nodo por id, scoped al tenant. */
  getNode(tenantId: string, nodeId: string): Promise<ZkNodeRef | null>;
  /** Lista nodos por tenant + filtros opcionales. */
  listNodes(
    tenantId: string,
    filter: { projectId?: string; type?: string; severity?: string; limit?: number },
  ): Promise<ZkNodeRef[]>;
  /** Sub-grafo desde root node con BFS limitado por depth. */
  expandSubgraph(
    tenantId: string,
    rootNodeId: string,
    depth: number,
  ): Promise<ZkNodeRef[]>;
}

// ────────────────────────────────────────────────────────────────────────
// Schema declaration
// ────────────────────────────────────────────────────────────────────────

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'zk.getNode',
    description:
      'Obtiene un nodo del Zettelkasten por id. Devuelve title, description, type, severity, connections. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string', description: 'Tenant id' },
        nodeId: { type: 'string', description: 'Node id (16 hex)' },
      },
      required: ['tenantId', 'nodeId'],
    },
  },
  {
    name: 'zk.listNodes',
    description:
      'Lista nodos filtrando por proyecto / tipo / severity. Use para descubrir nodos antes de query específica.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        projectId: { type: 'string' },
        type: { type: 'string' },
        severity: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['tenantId'],
    },
  },
  {
    name: 'zk.expandSubgraph',
    description:
      'Expande sub-grafo BFS desde un nodo raíz hasta depth N. Útil para "qué riesgos están conectados a este worker".',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        rootNodeId: { type: 'string' },
        depth: { type: 'number', description: 'Max depth (cap 3)' },
      },
      required: ['tenantId', 'rootNodeId'],
    },
  },
];

export const MCP_RESOURCES: McpResource[] = [
  {
    uri: 'zk://tenants',
    name: 'Accessible tenants',
    description: 'Tenants whose Zettelkasten is readable by current MCP session.',
    mimeType: 'application/json',
  },
];

// ────────────────────────────────────────────────────────────────────────
// Citation policy (CRITICAL — never invent data)
// ────────────────────────────────────────────────────────────────────────

export const ZK_CITATION_POLICY = `
Cuando uses información del Zettelkasten para responder, DEBES:
  1. Citar el id del nodo entre paréntesis al final de cada afirmación
     derivada del grafo: "El trabajador está en cuadrilla NE (zk:a1b2c3d4)".
  2. NUNCA inventar conexiones o severidades no presentes en los
     resultados. Si la query no devuelve nodos relevantes, di
     explícitamente "no tengo información en el grafo de este tenant".
  3. Tratar metadata como pista, no como fuente autoritativa fuera del
     proyecto al que pertenece el nodo.
` as const;

// ────────────────────────────────────────────────────────────────────────
// Handlers (puros — adaptador SDK los invoca)
// ────────────────────────────────────────────────────────────────────────

export interface HandlerContext {
  /** Tenants permitidos para esta sesión (filtrado upstream por auth). */
  allowedTenantIds: Set<string>;
  adapter: ZkReadAdapter;
}

const ERROR_CODE = {
  INVALID_PARAMS: -32602,
  METHOD_NOT_FOUND: -32601,
  PERMISSION_DENIED: -32000,
};

function err(id: number | string, code: number, message: string): McpResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function ensureAllowedTenant(
  ctx: HandlerContext,
  id: number | string,
  tenantId: unknown,
): McpResponse | string {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    return err(id, ERROR_CODE.INVALID_PARAMS, 'tenantId is required and must be a non-empty string');
  }
  if (!ctx.allowedTenantIds.has(tenantId)) {
    return err(id, ERROR_CODE.PERMISSION_DENIED, `tenant '${tenantId}' is not accessible`);
  }
  return tenantId;
}

export async function handleMcpRequest(
  request: McpRequest,
  ctx: HandlerContext,
): Promise<McpResponse> {
  const id = request.id;
  const params = (request.params ?? {}) as Record<string, unknown>;

  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'praeventio-zk', version: '1.0.0' },
          capabilities: { tools: {}, resources: {} },
          citationPolicy: ZK_CITATION_POLICY.trim(),
        },
      };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };

    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: MCP_RESOURCES } };

    case 'resources/read': {
      const uri = params.uri;
      if (uri === 'zk://tenants') {
        const all = await ctx.adapter.listAccessibleTenants();
        const visible = all.filter((t) => ctx.allowedTenantIds.has(t));
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ tenants: visible }),
              },
            ],
          },
        };
      }
      return err(id, ERROR_CODE.INVALID_PARAMS, `unknown resource uri: ${String(uri)}`);
    }

    case 'tools/call': {
      const name = params.name;
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (typeof name !== 'string') {
        return err(id, ERROR_CODE.INVALID_PARAMS, 'name is required');
      }
      try {
        const result = await dispatchTool(name, args, ctx);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(id, ERROR_CODE.INVALID_PARAMS, msg);
      }
    }

    default:
      return err(id, ERROR_CODE.METHOD_NOT_FOUND, `unknown method: ${request.method}`);
  }
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
): Promise<unknown> {
  switch (name) {
    case 'zk.getNode': {
      const tid = args.tenantId;
      if (typeof tid !== 'string' || !ctx.allowedTenantIds.has(tid)) {
        throw new Error('tenantId not accessible');
      }
      const nodeId = args.nodeId;
      if (typeof nodeId !== 'string' || nodeId.length === 0) {
        throw new Error('nodeId required');
      }
      const node = await ctx.adapter.getNode(tid, nodeId);
      if (!node) {
        return { node: null, citation: `(zk:not-found in tenant ${tid})` };
      }
      return { node, citation: `(zk:${node.id})` };
    }

    case 'zk.listNodes': {
      const tid = args.tenantId;
      if (typeof tid !== 'string' || !ctx.allowedTenantIds.has(tid)) {
        throw new Error('tenantId not accessible');
      }
      const filter: Parameters<ZkReadAdapter['listNodes']>[1] = {};
      if (typeof args.projectId === 'string') filter.projectId = args.projectId;
      if (typeof args.type === 'string') filter.type = args.type;
      if (typeof args.severity === 'string') filter.severity = args.severity;
      if (typeof args.limit === 'number') filter.limit = Math.min(100, Math.max(1, args.limit));
      else filter.limit = 25;
      const nodes = await ctx.adapter.listNodes(tid, filter);
      return {
        count: nodes.length,
        nodes,
        citations: nodes.map((n) => `(zk:${n.id})`),
      };
    }

    case 'zk.expandSubgraph': {
      const tid = args.tenantId;
      if (typeof tid !== 'string' || !ctx.allowedTenantIds.has(tid)) {
        throw new Error('tenantId not accessible');
      }
      const root = args.rootNodeId;
      if (typeof root !== 'string' || root.length === 0) {
        throw new Error('rootNodeId required');
      }
      const rawDepth = typeof args.depth === 'number' ? args.depth : 1;
      const depth = Math.min(3, Math.max(1, Math.floor(rawDepth)));
      const nodes = await ctx.adapter.expandSubgraph(tid, root, depth);
      return {
        depth,
        count: nodes.length,
        nodes,
        citations: nodes.map((n) => `(zk:${n.id})`),
      };
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
