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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  EmptyResultSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  MCP_TOOLS,
  MCP_RESOURCES,
  ZK_CITATION_POLICY,
  handleMcpRequest,
  type ZkReadAdapter,
} from './zettelkastenServer.js';

import { analyzeProjectWithClient, PROJECT_ANALYSIS_TOOL, type SamplingProject } from './projectAnalysis.js';
import { ACTION_PROMPTS, LEGAL_SEARCH_TOOL, prepareActionPrompt, searchNormativeForMcp } from './actionPrompts.js';
import type { NormativeRetriever } from '../rag/nativeNormativeContext.js';

export interface StdioAdapterConfig {
  serverName?: string;
  serverVersion?: string;
  /** Adapter inyectado por el caller (lee de Firestore en runtime). */
  zk: ZkReadAdapter;
  /** Operator opt-in for sharing these projects with the client's own model. */
  samplingProjects?: readonly SamplingProject[];
  /** Bounded public-law retrieval, with no inference or embedding dependency. */
  retrieveNormative?: NormativeRetriever;
}

/**
 * Crea y conecta un MCP server stdio. El proceso se mantiene vivo
 * hasta SIGINT. Returns el handle del server por si caller quiere
 * llamar `server.close()` explícito.
 */
export function createZettelkastenMcpServer(config: StdioAdapterConfig): Server {
  const server = new Server(
    {
      name: config.serverName ?? 'praeventio-zettelkasten',
      version: config.serverVersion ?? '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      // Citation policy va en el server-side instructions para que el
      // cliente LLM siempre cite nodos en sus respuestas.
      instructions: ZK_CITATION_POLICY,
    },
  );

  const samplingEnabled = () => Boolean(config.samplingProjects?.length && server.getClientCapabilities()?.sampling);
  // Session-local abuse ceiling: no background generation or unbounded fan-out.
  let samplingBusy = false;
  let windowStartedAt = Date.now();
  let windowCalls = 0;

  // Prepared prompts do not require client sampling. Context sharing still
  // requires the same explicit operator project opt-in. Public retrieval has
  // a separate session-local read ceiling shared with prompts/get.
  let contextBusy = false;
  let contextWindow = Date.now();
  let contextCalls = 0;
  async function withContextBudget<T>(fn: () => Promise<T>): Promise<T> {
    if (Date.now() - contextWindow >= 60_000) { contextWindow = Date.now(); contextCalls = 0; }
    if (contextBusy || contextCalls >= 6) throw new Error('mcp_prompt_rate_limited');
    contextBusy = true; contextCalls++;
    try { return await fn(); } finally { contextBusy = false; }
  }
  const promptDeps = () => ({ zk: config.zk, allowedProjects: config.samplingProjects ?? [],
    retrieveNormative: config.retrieveNormative });
  const safeContextError = (error: unknown) => error instanceof Error
    && /^mcp_(?:prompt|sampling)_[a-z_]+$/.test(error.message) ? error.message : 'mcp_prompt_unavailable';

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: config.samplingProjects?.length ? ACTION_PROMPTS : [],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    if (!config.samplingProjects?.length) throw new Error('mcp_prompt_not_enabled');
    try { return await withContextBudget(() => prepareActionPrompt(request.params.name, request.params.arguments ?? {}, promptDeps())); }
    catch (error) { throw new Error(safeContextError(error), { cause: error }); }
  });

  // ── tools/list ─────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...MCP_TOOLS, ...(config.retrieveNormative ? [LEGAL_SEARCH_TOOL] : []),
      ...(samplingEnabled() ? [PROJECT_ANALYSIS_TOOL] : [])],
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
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name === LEGAL_SEARCH_TOOL.name) {
      try {
        const result = await withContextBudget(() => searchNormativeForMcp(request.params.arguments ?? {}, promptDeps()));
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: result.reason === 'store_unavailable' };
      } catch (error) { return { content: [{ type: 'text' as const, text: safeContextError(error) }], isError: true }; }
    }
    if (request.params.name === PROJECT_ANALYSIS_TOOL.name) {
      const failure = (code: string) => ({ content: [{ type: 'text' as const, text: code }], isError: true });
      if (!samplingEnabled()) return failure('mcp_sampling_not_enabled');
      if (Date.now() - windowStartedAt >= 60_000) { windowStartedAt = Date.now(); windowCalls = 0; }
      if (samplingBusy || windowCalls >= 6) return failure('mcp_sampling_rate_limited');
      samplingBusy = true;
      windowCalls++;
      try {
        const result = await analyzeProjectWithClient(request.params.arguments ?? {}, {
          zk: config.zk,
          allowedProjects: config.samplingProjects ?? [],
          sample: async params => {
            // SDK 1.32.1 ignores cancellation for outbound request id 0.
            // Reserve that first id for a bounded, data-free liveness ping;
            // sampling then has a cancellable id (regression-tested via SDK).
            await server.request({ method: 'ping' }, EmptyResultSchema, { timeout: 5_000, signal: extra.signal });
            return server.createMessage(params, { timeout: 30_000, signal: extra.signal });
          },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: false };
      } catch (error) {
        // Never echo a DB/SDK/provider error, context, keys or client response.
        const code = error instanceof Error && /^mcp_sampling_[a-z_]+$/.test(error.message)
          ? error.message : 'mcp_sampling_unavailable';
        return failure(code);
      } finally {
        samplingBusy = false;
      }
    }
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

  return server;
}

export async function startStdioMcpServer(config: StdioAdapterConfig): Promise<Server> {
  // Keep importing this module free of stdin/stdout side effects.
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = createZettelkastenMcpServer(config);
  await server.connect(new StdioServerTransport());
  return server;
}
