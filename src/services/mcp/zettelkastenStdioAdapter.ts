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

  // ── tools/call ─────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
      { zk: config.zk },
    );

    if (response.error) {
      return {
        content: [{ type: 'text', text: response.error.message }],
        isError: true,
      };
    }

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
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'resources/read',
        params: { uri: request.params.uri },
      },
      { zk: config.zk },
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
