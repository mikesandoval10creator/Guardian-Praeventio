import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createZettelkastenMcpServer } from './zettelkastenStdioAdapter';
import type { TypedEdgesReader } from './typedEdges';
const active: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of active.splice(0)) await close(); });
async function connect(enabled = true, projects = [{ tenantId: 't1', projectId: 'p1' }]) {
  const read = vi.fn<TypedEdgesReader>(async input => ({ source: 'stored-typed-edges', tenantId: input.tenantId, projectId: input.projectId, bounded: true, scanLimited: false, omitted: 0,
    edges: [{ id:'edge-01',fromNodeId:'n1',toNodeId:'n2',type:'mitigates',inverseType:'mitigated_by',weight:0.8 }] }));
  const server = createZettelkastenMcpServer({ zk: { listAccessibleTenants: async () => ['t1'], getNode: async () => null, listNodes: async () => [], expandSubgraph: async () => [] }, samplingProjects: projects,
    ...(enabled ? { readEdges: read } : {}) });
  const client = new Client({ name:'edges-fixture',version:'1' },{capabilities:{}});
  const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  active.push(async () => { await client.close(); await server.close(); });
  return { client, read };
}
const args = {tenantId:'t1',projectId:'p1'};
function payload(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as Array<{type:string;text:string}>; return JSON.parse(content[0].text);
}
describe('zk.listEdges actual SDK contract, no client sampling', () => {
  it('is hidden/denied by default', async () => {
    const {client,read}=await connect(false);
    expect((await client.listTools()).tools.some(t=>t.name==='zk.listEdges')).toBe(false);
    expect((await client.callTool({name:'zk.listEdges',arguments:args})).isError).toBe(true); expect(read).not.toHaveBeenCalled();
  });
  it('requires configured projects even with a reader', async () => {
    const {client,read}=await connect(true,[]); expect((await client.listTools()).tools.some(t=>t.name==='zk.listEdges')).toBe(false);
    expect((await client.callTool({name:'zk.listEdges',arguments:args})).isError).toBe(true); expect(read).not.toHaveBeenCalled();
  });
  it('advertises read-only and exposes stored relations without a model request', async () => {
    const {client,read}=await connect(); const tool=(await client.listTools()).tools.find(t=>t.name==='zk.listEdges'); expect(tool?.annotations?.readOnlyHint).toBe(true);
    const result=await client.callTool({name:'zk.listEdges',arguments:args}); expect(result.isError).toBe(false); expect(payload(result).edges[0]).toMatchObject({type:'mitigates',inverseType:'mitigated_by',weight:0.8}); expect(read).toHaveBeenCalledExactlyOnceWith({...args,limit:25});
  });
  it.each([{tenantId:'t2',projectId:'p1'}, {tenantId:'t1',projectId:'p2'}, {tenantId:'t1'}, {...args,limit:51}, {...args,nodeId:'n1'}, {...args,limit:0}])('rejects invalid or foreign scope before reader %j', async input => {
    const {client,read}=await connect(); const result=await client.callTool({name:'zk.listEdges',arguments:input}); expect(result.isError).toBe(true); expect(read).not.toHaveBeenCalled();
  });
  it('does not leak unexpected storage errors', async () => {
    const {client,read}=await connect(); read.mockRejectedValue(new Error('private-token/path/project'));
    const result=await client.callTool({name:'zk.listEdges',arguments:args}); expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toMatch(/private-token|path\/project/);
  });
  it('uses the context budget and rejects simultaneous requests', async () => {
    const {client,read}=await connect(); let release!: (value: Awaited<ReturnType<TypedEdgesReader>>) => void;
    const value = await read(args); read.mockClear(); read.mockImplementationOnce(() => new Promise(r=>{release=r;}));
    const first=client.callTool({name:'zk.listEdges',arguments:args}); await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(1));
    try { expect((await client.callTool({name:'zk.listEdges',arguments:args})).isError).toBe(true); }
    finally { release(value); await first; }
    for(let i=0;i<5;i++) expect((await client.callTool({name:'zk.listEdges',arguments:args})).isError).toBe(false);
    expect((await client.callTool({name:'zk.listEdges',arguments:args})).isError).toBe(true);
  });
});
