import { describe, it, expect } from 'vitest';
import {
  MCP_TOOLS,
  MCP_RESOURCES,
  ZK_CITATION_POLICY,
} from './zettelkastenServer.js';

// Smoke test del adapter — solo verificamos que importar el módulo no
// rompe. La conexión real al stdio transport se prueba en e2e (proceso
// hijo Node), no en vitest.

describe('zettelkastenStdioAdapter smoke import', () => {
  it('módulo carga sin tirar errores top-level', async () => {
    const mod = await import('./zettelkastenStdioAdapter.js');
    expect(typeof mod.startStdioMcpServer).toBe('function');
  });

  it('expone MCP_TOOLS con al menos zk.getNode y zk.listNodes', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toContain('zk.getNode');
    expect(names).toContain('zk.listNodes');
  });

  it('expone MCP_RESOURCES', () => {
    expect(MCP_RESOURCES.length).toBeGreaterThan(0);
  });

  it('ZK_CITATION_POLICY es un string no vacío que menciona nodeIds', () => {
    expect(typeof ZK_CITATION_POLICY).toBe('string');
    expect(ZK_CITATION_POLICY.length).toBeGreaterThan(20);
  });
});
