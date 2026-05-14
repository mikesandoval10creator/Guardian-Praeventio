#!/usr/bin/env node
/**
 * Praeventio Guardian — MCP stdio server entrypoint.
 *
 * Conecta el `zettelkastenStdioAdapter` con un Firestore Admin
 * instance + lista de tenants accesibles. Pensado para invocarse desde
 * Claude Desktop / Gemini CLI / ChatGPT MCP vía `mcp.json`:
 *
 * {
 *   "mcpServers": {
 *     "praeventio-zk": {
 *       "command": "node",
 *       "args": ["/abs/path/to/repo/bin/mcp-server.mjs"],
 *       "env": {
 *         "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/sa.json",
 *         "PRAEVENTIO_MCP_TENANTS": "tenant-a,tenant-b"
 *       }
 *     }
 *   }
 * }
 *
 * El entrypoint:
 *   1. Valida env vars (GOOGLE_APPLICATION_CREDENTIALS,
 *      PRAEVENTIO_MCP_TENANTS).
 *   2. Inicializa `firebase-admin` con las credentials del SA.
 *   3. Construye `createZkFirebaseReadAdapter` con la whitelist de
 *      tenants.
 *   4. Llama `startStdioMcpServer({ zk })`.
 *
 * Read-only por contrato — los MCP_TOOLS solo declaran getNode /
 * listNodes / expandSubgraph (sin write).
 *
 * Esta línea ejecutable se mantiene MUY chica para que sea
 * auditable de un vistazo. Toda la lógica vive en módulos
 * unit-tested.
 */

import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import process from 'node:process';

// El TypeScript se compila al directorio dist/ vía `tsc` (config
// separado para Node ESM). El entrypoint asume que el build ya corrió.
// Para dev, ejecutamos con `tsx` que transpila on-the-fly.
import { createZkFirebaseReadAdapter } from '../dist/server/mcp/zkFirebaseReadAdapter.js';
import { startStdioMcpServer } from '../dist/services/mcp/zettelkastenStdioAdapter.js';

function readTenants() {
  const raw = process.env.PRAEVENTIO_MCP_TENANTS;
  if (!raw || raw.trim().length === 0) {
    console.error(
      'mcp-server: PRAEVENTIO_MCP_TENANTS no configurada. ' +
        'Define una lista CSV de tenants accesibles para este server, e.g.:',
    );
    console.error('  PRAEVENTIO_MCP_TENANTS=tenant-mineria-x,tenant-construccion-y');
    process.exit(1);
  }
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (list.length === 0) {
    console.error('mcp-server: PRAEVENTIO_MCP_TENANTS vacía tras parsing.');
    process.exit(1);
  }
  return list;
}

function initAdmin() {
  // Tres formas válidas, en orden de prioridad:
  //   1. GOOGLE_APPLICATION_CREDENTIALS apuntando a JSON de SA
  //   2. FIREBASE_SERVICE_ACCOUNT_JSON con el contenido inline
  //   3. applicationDefault() (gcloud auth en dev)
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const abs = resolvePath(credPath);
    if (!existsSync(abs)) {
      console.error(`mcp-server: GOOGLE_APPLICATION_CREDENTIALS path no existe: ${abs}`);
      process.exit(1);
    }
    const json = JSON.parse(readFileSync(abs, 'utf8'));
    return initializeApp({ credential: cert(json) });
  }
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim().length > 0) {
    try {
      const json = JSON.parse(inline);
      return initializeApp({ credential: cert(json) });
    } catch (err) {
      console.error('mcp-server: FIREBASE_SERVICE_ACCOUNT_JSON no es JSON válido', err);
      process.exit(1);
    }
  }
  return initializeApp({ credential: applicationDefault() });
}

async function main() {
  const tenants = readTenants();
  const app = initAdmin();
  const firestore = getFirestore(app);

  const zk = createZkFirebaseReadAdapter({
    firestore,
    accessibleTenants: tenants,
  });

  // El server se mantiene vivo via stdio transport hasta SIGINT.
  await startStdioMcpServer({
    serverName: process.env.PRAEVENTIO_MCP_NAME ?? 'praeventio-zettelkasten',
    serverVersion: process.env.PRAEVENTIO_MCP_VERSION ?? '1.0.0',
    zk,
  });

  // Log a stderr para no contaminar el stdio transport (stdout).
  console.error(
    `mcp-server: listening on stdio. Tenants accesibles: ${tenants.join(', ')}`,
  );

  // Graceful shutdown.
  const onSignal = (signal) => {
    console.error(`mcp-server: received ${signal}, shutting down.`);
    process.exit(0);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}

main().catch((err) => {
  console.error('mcp-server: fatal error', err);
  process.exit(1);
});
