// Praeventio Guard — Sprint 49 activación @modelcontextprotocol/sdk.
//
// Wrapper CLI/programmático sobre `zettelkastenStdioAdapter`. Antes de
// instalar la dep `@modelcontextprotocol/sdk` el adapter existía pero
// no había un entrypoint TS limpio para dispararlo desde código (el
// único entry era `bin/mcp-server.mjs`, que asume Firestore Admin).
//
// Este módulo expone:
//
//   - `bootStdioMcpServer(zk, options?)` — helper async para iniciar el
//     server stdio cuando el caller ya tiene un `ZkReadAdapter` listo
//     (útil en testing, en server.ts o en un launcher tipo lambda).
//   - `assertSdkAvailable()` — pequeña guard que verifica que la dep
//     opcional esté instalada, con mensaje accionable si falta.
//
// NO se ejecuta automáticamente al importar el módulo (zero side-effect).
// El entrypoint productivo sigue siendo `bin/mcp-server.mjs`.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  startStdioMcpServer,
  type StdioAdapterConfig,
} from './zettelkastenStdioAdapter.js';

// Re-exportamos para que callers tipen un único import path.
export type { StdioAdapterConfig } from './zettelkastenStdioAdapter.js';

/** Smoke-test: la dep `@modelcontextprotocol/sdk` resolvió al cargar. */
export function assertSdkAvailable(): void {
  if (typeof StdioServerTransport !== 'function') {
    throw new Error(
      'MCP SDK no disponible. Instala `@modelcontextprotocol/sdk` o ' +
        'asegúrate de que el bundler no lo esté tree-shaking en runtime Node.',
    );
  }
}

/**
 * Arranca el stdio MCP server. Wrapper thin sobre `startStdioMcpServer`
 * — el motivo de existir es centralizar el boot path para que
 * futuros transports (sse, websocket) puedan agregarse acá sin tocar
 * el adapter core.
 */
export async function bootStdioMcpServer(config: StdioAdapterConfig): Promise<void> {
  assertSdkAvailable();
  const server = await startStdioMcpServer(config);

  // Graceful shutdown: cerramos el server si el proceso recibe señales.
  // No hacemos `process.exit` acá — dejamos que el caller decida.
  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`stdioBoot: ${signal} recibido, cerrando server.\n`);
    try {
      await server.close();
    } catch (err) {
      process.stderr.write(`stdioBoot: error cerrando server: ${String(err)}\n`);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}
