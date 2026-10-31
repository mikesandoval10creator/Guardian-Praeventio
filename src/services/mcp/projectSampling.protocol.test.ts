import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateMessageRequestSchema, type CreateMessageRequest } from '@modelcontextprotocol/sdk/types.js';
import * as moduleUnderTest from './zettelkastenStdioAdapter.js';
import type { ZkReadAdapter } from './zettelkastenServer.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const projects = [{ tenantId: 't1', projectId: 'p1' }];
async function connect(sampling = true, enabled = true, typed = false, recordText?: string) {
  const zk: ZkReadAdapter = {
    listAccessibleTenants: async () => ['t1'], getNode: async () => null,
    listNodes: async () => [{ id: 'n1', type: 'NOTE', title: recordText ?? 'Observation', description: recordText ?? 'Verified record',
      projectId: 'p1', tenantId: 't1', tags: [], connections: [] },
      { id: 'n2', type: 'NOTE', title: 'Control', description: 'Stored control', projectId: 'p1', tenantId: 't1', tags: [], connections: [] }],
    expandSubgraph: async () => [],
  };
  const readEdges = vi.fn(async () => ({ source: 'stored-typed-edges' as const, tenantId: 't1', projectId: 'p1', bounded: true as const, scanLimited: false, omitted: 0,
    edges: [{ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', type: 'mitigates' as const, inverseType: 'mitigated_by', weight: 0.8 }] }));
  const server = moduleUnderTest.createZettelkastenMcpServer({ zk, samplingProjects: enabled ? projects : [], ...(typed ? { readEdges } : {}) });
  const client = new Client({ name: 'controlled-user-client', version: '1.0' }, { capabilities: sampling ? { sampling: {} } : {} });
  const onSampling = vi.fn(async (_request: CreateMessageRequest) => ({ role: 'assistant' as const,
    model: 'user-selected-test-model', content: { type: 'text' as const, text: 'Verified record (zk:n1)' } }));
  if (sampling) client.setRequestHandler(CreateMessageRequestSchema, onSampling);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  cleanup.push(() => server.close());
  await client.connect(clientTransport);
  cleanup.push(() => client.close());
  return { client, onSampling, readEdges };
}

describe('MCP SDK client-owned model vertical', () => {
  it('minimizes synthetic sensitive text across the actual SDK request', async () => {
    const {client,onSampling}=await connect(true,true,true,'Report privacy.fixture@example.test RUT 12.345.678-9');
    const result=await client.callTool({name:'zk.analyzeProject',arguments:{tenantId:'t1',projectId:'p1',question:'Contact privacy.fixture@example.test',includeTypedEdges:true}});
    expect(result.isError).toBe(false);
    const content=onSampling.mock.calls[0][0].params.messages[0].content;
    if(Array.isArray(content)||content.type!=='text')throw new Error('Expected controlled text');
    const body=JSON.parse(content.text);expect(body.question).toContain('[EMAIL_REDACTED]');
    expect(body.records[0].title).toContain('[RUT_REDACTED]');expect(body.typedRelations.edges[0].id).toBe('e1');
    expect(content.text).not.toMatch(/privacy\.fixture@example\.test|12\.345\.678-9/);
  });
  it('shares typed relations only when operator and caller opt in through the actual SDK', async () => {
    const { client, onSampling, readEdges } = await connect(true, true, true);
    onSampling.mockResolvedValueOnce({role:'assistant',model:'user-selected-test-model',content:{type:'text',text:'Stored relation (zk:n1) (zk-edge:e1)'}});
    const result = await client.callTool({ name:'zk.analyzeProject', arguments:{tenantId:'t1',projectId:'p1',question:'Describe relations',includeTypedEdges:true} });
    expect(result.isError).toBe(false); expect(JSON.stringify(result)).toContain('contextEdgeIds');
    expect(readEdges).toHaveBeenCalledExactlyOnceWith({tenantId:'t1',projectId:'p1',limit:12});
    const content=onSampling.mock.calls[0][0].params.messages[0].content;
    if (Array.isArray(content) || content.type !== 'text') throw new Error('Expected one controlled text message');
    expect(JSON.parse(content.text).typedRelations.edges[0].id).toBe('e1');
  });
  it('negotiates sampling and returns the client response through tools/call without a server model', async () => {
    const { client, onSampling } = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map(t => t.name)).toContain('zk.analyzeProject');
    const result = await client.callTool({ name: 'zk.analyzeProject', arguments: { tenantId: 't1', projectId: 'p1', question: 'Summarize' } });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result)).toContain('mcp-client-sampling');
    expect(JSON.stringify(result)).toContain('Verified record (zk:n1)');
    expect(onSampling).toHaveBeenCalledOnce();
    expect(onSampling.mock.calls[0][0].params).toMatchObject({ maxTokens: 768, includeContext: 'none' });
  });

  it('does not advertise or execute sampling when the operator has not enabled project sharing', async () => {
    const { client, onSampling } = await connect(true, false);
    expect((await client.listTools()).tools.map(t => t.name)).not.toContain('zk.analyzeProject');
    const result = await client.callTool({ name: 'zk.analyzeProject', arguments: { tenantId: 't1', projectId: 'p1', question: 'Summarize' } });
    expect(result.isError).toBe(true);
    expect(onSampling).not.toHaveBeenCalled();
  });

  it('keeps the original read tools usable for clients without sampling', async () => {
    const { client } = await connect(false);
    expect((await client.listTools()).tools.map(t => t.name)).not.toContain('zk.analyzeProject');
    const result = await client.callTool({ name: 'zk.listNodes', arguments: { tenantId: 't1', projectId: 'p1' } });
    expect(result.isError).toBe(false);
  });

  it('contains client refusals without returning provider details', async () => {
    const { client, onSampling } = await connect();
    onSampling.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAIL'));
    const result = await client.callTool({ name: 'zk.analyzeProject', arguments: { tenantId: 't1', projectId: 'p1', question: 'Summarize' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('mcp_sampling_unavailable');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_DETAIL');
  });

  it('cancels client sampling and refuses concurrent fan-out in the same session', async () => {
    const { client } = await connect();
    let started = false;
    let cancelled = false;
    client.setRequestHandler(CreateMessageRequestSchema, async (_request, extra) => {
      started = true;
      return new Promise<never>((_resolve, reject) => {
        extra.signal.addEventListener('abort', () => {
          cancelled = true;
          reject(new Error('controlled cancellation'));
        }, { once: true });
      });
    });
    const controller = new AbortController();
    const call = { name: 'zk.analyzeProject', arguments: { tenantId: 't1', projectId: 'p1', question: 'Summarize' } };
    const pending = client.callTool(call, undefined, { signal: controller.signal });
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(started).toBe(true));
    const concurrent = await client.callTool(call);
    expect(JSON.stringify(concurrent)).toContain('mcp_sampling_rate_limited');
    controller.abort();
    await rejection;
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });

  it('enforces the six-call session ceiling before sending more sampling requests', async () => {
    const { client, onSampling } = await connect();
    for (let i = 0; i < 6; i++) {
      expect((await client.callTool({ name: 'zk.analyzeProject', arguments: { tenantId: 't1', projectId: 'p1', question: 'Summarize' } })).isError).toBe(false);
    }
    const blocked = await client.callTool({ name: 'zk.analyzeProject', arguments: { tenantId: 't1', projectId: 'p1', question: 'Summarize' } });
    expect(blocked.isError).toBe(true);
    expect(JSON.stringify(blocked)).toContain('mcp_sampling_rate_limited');
    expect(onSampling).toHaveBeenCalledTimes(6);
  });
});
