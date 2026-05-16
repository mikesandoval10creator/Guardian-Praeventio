// Praeventio Guard — Sprint 45 D.11 (cierre): stdio adapter para MCP server.
//
// Wrapper que conecta el motor puro `zettelkastenServer.ts` con
// `@modelcontextprotocol/sdk` (transport stdio). Permite que Claude
// Desktop / Gemini CLI / ChatGPT MCP consuman el Zettelkasten del
// tenant vía configuración `mcp.json`.
//
// Read-only por política. Citation policy se inyecta en system-prompt
// vía la metadata del server.
//
// Build flag: este adapter SE EJECUTA en un proceso Node separado
// (entrypoint `bin/mcp-server.mjs`) — no se bundlea con la app web.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  MCP_TOOLS,
  MCP_RESOURCES,
  ZK_CITATION_POLICY,
  handleMcpRequest,
  type ZkReadAdapter,
} from './zettelkastenServer.js';

export interface StdioAdapterConfig {
  serverName?: string;
  serverVersion?: string;
  /** Adapter inyectado por el caller (lee de Firestore en runtime). */
  zk: ZkReadAdapter;
}

/**
 * Crea y conecta un MCP server stdio. El proceso se mantiene vivo
 * hasta SIGINT. Returns el handle del server por si caller quiere
 * llamar `server.close()` explícito.
 */
export async function startStdioMcpServer(config: StdioAdapterConfig): Promise<Server> {
  const server = new Server(
    {
      name: config.serverName ?? 'praeventio-zettelkasten',
      version: config.serverVersion ?? '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      // Citation policy va en el server-side instructions para que el
      // cliente LLM siempre cite nodos en sus respuestas.
      instructions: ZK_CITATION_POLICY,
    },
  );

  // ── tools/list ─────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS,
  }));

  // Codex P2 fix (PR #263, 2026-05-15): poblar allowedTenantIds desde el
  // adapter en lugar de pasar Set vacío. Sin esto, `ctx.allowedTenantIds.has()`
  // rechaza TODAS las requests con "tenantId not accessible" — haciendo el
  // stdio server inútil. El adapter ya expone listAccessibleTenants() y el
  // caller (server.ts / bin/mcp-server.mjs) lo configura con su política.
  // Cacheamos por proceso para no re-leer Firestore por cada request; el
  // stdio MCP server normalmente sirve a un único cliente LLM por proceso.
  let cachedAllowedTenants: Set<string> | null = null;
  const getAllowedTenants = async (): Promise<Set<string>> => {
    if (cachedAllowedTenants) return cachedAllowedTenants;
    const tenants = await config.zk.listAccessibleTenants();
    cachedAllowedTenants = new Set(tenants);
    return cachedAllowedTenants;
  };

  // ── tools/call ─────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const allowedTenantIds = await getAllowedTenants();
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: {
          name: request.params.name,
          arguments: request.params.arguments ?? {},
        },
      },
      { allowedTenantIds, adapter: config.zk },
    );

    if (response.error) {
      return {
        content: [{ type: 'text', text: response.error.message }],
        isError: true,
      };
    }

    // Codex P2 fix (PR #268 follow-up, 2026-05-15): `handleMcpRequest` para
    // tools/call YA devuelve el MCP envelope `{content: [...], isError}` en
    // su `.result`. Antes lo re-wrapeábamos en otro `content[0].text` con
    // JSON.stringify del envelope completo → clientes recibían el envelope
    // nested y tenían que unwrap dos veces para leer el payload.
    // Ahora pasamos el envelope tal cual viene del server core.
    const result = response.result as
      | { content: Array<{ type: string; text?: string }>; isError?: boolean }
      | undefined;
    if (result && Array.isArray(result.content)) {
      return {
        content: result.content,
        isError: result.isError ?? false,
      };
    }

    // Fallback defensivo (no debería darse con el core actual, pero si una
    // futura versión cambia el shape, evitamos crash silencioso).
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  });

  // ── resources/list ─────────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: MCP_RESOURCES,
  }));

  // ── resources/read ─────────────────────────────────────────────────────
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const allowedTenantIds = await getAllowedTenants();
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'resources/read',
        params: { uri: request.params.uri },
      },
      { allowedTenantIds, adapter: config.zk },
    );

    if (response.error) {
      throw new Error(response.error.message);
    }

    const result = response.result as { mimeType?: string; text?: string } | undefined;
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: result?.mimeType ?? 'application/json',
          text: result?.text ?? JSON.stringify(result),
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
