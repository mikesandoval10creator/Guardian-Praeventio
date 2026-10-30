import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createZettelkastenMcpServer } from './zettelkastenStdioAdapter.js';
import { searchPublicLawChunks } from '../rag/nativeNormativeContext.js';
import type { ZkReadAdapter } from './zettelkastenServer.js';

const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of close.splice(0).reverse()) await fn(); });
async function connect(enabled = true) {
  const listNodes = vi.fn(async () => [{ id: 'n1', tenantId: 't1', projectId: 'p1', type: 'NOTE',
    title: 'Project record', description: 'ruido ocupacional; contact test@example.org', tags: [], connections: [], metadata: { private: 'PRIVATE_METADATA' } }]);
  const zk: ZkReadAdapter = { listAccessibleTenants: async () => ['t1'], listNodes, getNode: async () => null, expandSubgraph: async () => [] };
  const retrieveNormative = vi.fn(async (query: string) => searchPublicLawChunks(query, [{ id: 'law-1234-chunk-0',
    data: { lawId: '1234', title: 'DS 594 fixture', content: 'Texto controlado sobre ruido ocupacional.' } }]));
  const server = createZettelkastenMcpServer({ zk, samplingProjects: enabled ? [{ tenantId: 't1', projectId: 'p1' }] : [], retrieveNormative });
  // Deliberately NO sampling capability or model handler: MCP prompts are
  // prepared context for the user's host, not an inference request from Guardian.
  const client = new Client({ name: 'user-host-no-sampling', version: '1' }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); close.push(() => server.close());
  await client.connect(ct); close.push(() => client.close());
  return { client, listNodes, retrieveNormative };
}
const cases = [
  { action: 'getChatResponse', args: ['ruido ocupacional', 'SPOOFED-CONTEXT'] },
  { action: 'queryBCN', args: ['ruido ocupacional'] },
  { action: 'getSafetyAdvice', args: [{ temp: 32, uv: 8 }] },
  { action: 'calculateStructuralLoad', args: ['eslinga', '2 toneladas'] },
  { action: 'designHazmatStorage', args: ['bodega', 100, 'Clase 3'] },
  { action: 'evaluateMinsalCompliance', args: ['PREXOR', 'ruido ocupacional', 'minería'] },
];

describe('MCP action prompt delegation and native legal tool', () => {
  it('advertises and prepares all six real action contracts without client sampling', async () => {
    const { client } = await connect();
    expect((await client.listPrompts()).prompts.map(p => p.name).sort()).toEqual(cases.map(c => `guardian.${c.action}`).sort());
    for (const c of cases) {
      const result = await client.getPrompt({ name: `guardian.${c.action}`, arguments: { tenantId: 't1', projectId: 'p1', input: JSON.stringify(c.args) } });
      const text = JSON.stringify(result);
      expect(text).toContain('SOLO CONSULTIVO');
      expect(text).toContain('Project record');
      expect(text).not.toContain('SPOOFED-CONTEXT');
      expect(text).not.toContain('test@example.org');
      expect(text).not.toContain('PRIVATE_METADATA');
    }
  });
  it('searches public indexed law through a real tools/call without a model', async () => {
    const { client, listNodes } = await connect();
    const result = await client.callTool({ name: 'legal.searchNormative', arguments: { tenantId: 't1', query: 'ruido ocupacional' } });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result)).toContain('law-1234-chunk-0');
    expect(JSON.stringify(result)).toContain('lexical');
    expect(listNodes).not.toHaveBeenCalled();
  });
  it('marks unavailable storage as an error, not as successful empty evidence', async () => {
    const { client, retrieveNormative } = await connect();
    retrieveNormative.mockResolvedValueOnce({ method: 'lexical', matches: [], scanLimited: false, reason: 'store_unavailable' });
    const result = await client.callTool({ name: 'legal.searchNormative', arguments: { tenantId: 't1', query: 'ruido ocupacional' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('store_unavailable');
  });
  it('does not advertise prompts or read project context without operator opt-in', async () => {
    const { client, listNodes, retrieveNormative } = await connect(false);
    expect((await client.listPrompts()).prompts).toEqual([]);
    await expect(client.getPrompt({ name: 'guardian.queryBCN', arguments: { tenantId: 't1', projectId: 'p1', input: '["ruido ocupacional"]' } })).rejects.toThrow('mcp_prompt_not_enabled');
    expect(listNodes).not.toHaveBeenCalled(); expect(retrieveNormative).not.toHaveBeenCalled();
  });
  it.each([{ tenantId: 'foreign', projectId: 'p1' }, { tenantId: 't1', projectId: 'foreign' }])('rejects foreign scope before reads', async scope => {
    const { client, listNodes, retrieveNormative } = await connect();
    await expect(client.getPrompt({ name: 'guardian.queryBCN', arguments: { ...scope, input: '["ruido ocupacional"]' } })).rejects.toThrow();
    expect(listNodes).not.toHaveBeenCalled(); expect(retrieveNormative).not.toHaveBeenCalled();
  });
  it.each(['not JSON', '{}', '["x"]', '["ruido ocupacional",{"nested":"not accepted"}]'])('rejects malformed action input before reading context', async input => {
    const { client, listNodes } = await connect();
    await expect(client.getPrompt({ name: 'guardian.queryBCN', arguments: { tenantId: 't1', projectId: 'p1', input } })).rejects.toThrow('mcp_prompt_invalid_arguments');
    expect(listNodes).not.toHaveBeenCalled();
  });
  it('redacts a read failure at the actual SDK error boundary', async () => {
    const { client, listNodes } = await connect();
    listNodes.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DETAIL'));
    const error = await client.getPrompt({ name: 'guardian.queryBCN', arguments: {
      tenantId: 't1', projectId: 'p1', input: '["ruido ocupacional"]' } }).then(() => null, e => e);
    expect(String(error)).toContain('mcp_prompt_unavailable');
    expect(String(error)).not.toContain('PRIVATE_DATABASE_DETAIL');
  });
  it('does not allow arbitrary action names or write operations', async () => {
    const { client, listNodes } = await connect();
    await expect(client.getPrompt({ name: 'guardian.deleteProject', arguments: { tenantId: 't1', projectId: 'p1', input: '[]' } })).rejects.toThrow('mcp_prompt_invalid_arguments');
    expect(listNodes).not.toHaveBeenCalled();
  });
  it('rejects foreign-tenant public retrieval without touching the store', async () => {
    const { client, retrieveNormative } = await connect();
    const result = await client.callTool({ name: 'legal.searchNormative', arguments: { tenantId: 'foreign', query: 'ruido ocupacional' } });
    expect(result.isError).toBe(true); expect(retrieveNormative).not.toHaveBeenCalled();
  });
  it('enforces a shared six-call read budget for prepared prompts and legal retrieval', async () => {
    const { client, retrieveNormative } = await connect();
    for (let i = 0; i < 6; i++) await client.getPrompt({ name: 'guardian.getSafetyAdvice', arguments: { tenantId: 't1', projectId: 'p1', input: '[{"temp":32}]' } });
    const result = await client.callTool({ name: 'legal.searchNormative', arguments: { tenantId: 't1', query: 'ruido ocupacional' } });
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('mcp_prompt_rate_limited');
    expect(retrieveNormative).not.toHaveBeenCalled();
  });
});
