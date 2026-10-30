import { describe, expect, it, vi } from 'vitest';
import { analyzeProjectWithClient, type ProjectSamplingRequest } from './projectAnalysis';
import type { TypedEdgesReader } from './typedEdges';
import type { ZkNodeRef } from './zettelkastenServer';
const args = { tenantId: 't1', projectId: 'p1', question: 'Describe stored relations', includeTypedEdges: true };
const edge = { id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', type: 'mitigates' as const, inverseType: 'mitigated_by', weight: 0.8 };
function fixture() {
  const nodes: ZkNodeRef[] = ['n1','n2'].map(id => ({ id, tenantId:'t1', projectId:'p1', type:'NOTE',title:'Record',description:'Observed data',tags:[],connections:[] }));
  const readEdges = vi.fn<TypedEdgesReader>(async () => ({ source:'stored-typed-edges',tenantId:'t1',projectId:'p1',bounded:true,scanLimited:false,omitted:0,edges:[edge] }));
  const sample = vi.fn(async (_request: ProjectSamplingRequest) => ({ content:{type:'text',text:'Stored relation (zk:n1) (zk-edge:e1)'} }));
  return { readEdges, sample, allowedProjects:[{tenantId:'t1',projectId:'p1'}], zk:{listAccessibleTenants:async()=>['t1'],listNodes:vi.fn(async()=>nodes),getNode:async()=>null,expandSubgraph:async()=>[]} };
}
describe('typed relations explicitly shared with client sampling', () => {
  it('uses the existing reader and sends only stored relations whose endpoints are in context', async () => {
    const deps=fixture(); const result=await analyzeProjectWithClient(args,deps);
    expect(deps.readEdges).toHaveBeenCalledExactlyOnceWith({tenantId:'t1',projectId:'p1',limit:12});
    const request=deps.sample.mock.calls[0][0]; const body=JSON.parse(request.messages[0].content.text);
    expect(body.typedRelations.edges).toEqual([edge]); expect(result).toMatchObject({contextEdgeIds:['e1'],sampled:true,advisory:true});
    expect(request.systemPrompt).toMatch(/zk-edge:ID/); expect(request.systemPrompt).toMatch(/eficacia/i);
  });
  it('requires an explicit caller opt-in even when a reader is configured', async () => {
    const deps=fixture(); deps.sample.mockResolvedValue({content:{type:'text',text:'Node record (zk:n1)'}});
    await analyzeProjectWithClient({...args,includeTypedEdges:false},deps); expect(deps.readEdges).not.toHaveBeenCalled();
    expect(JSON.parse(deps.sample.mock.calls[0][0].messages[0].content.text).typedRelations).toBeUndefined();
  });
  it('fails explicitly when requested relations are disabled by the operator', async () => {
    const deps=fixture(); const {readEdges:_unused,...disabled}=deps;
    await expect(analyzeProjectWithClient(args,disabled)).rejects.toThrow('mcp_sampling_edges_not_enabled');
    expect(deps.sample).not.toHaveBeenCalled(); expect(deps.zk.listNodes).not.toHaveBeenCalled();
  });
  it('discards relations outside the node subset and strips creator metadata', async () => {
    const deps=fixture(); deps.readEdges.mockResolvedValue({source:'stored-typed-edges',tenantId:'t1',projectId:'p1',bounded:true,scanLimited:true,omitted:1,edges:[{...edge,createdBy:'private-worker',metadata:{secret:'private'}} as typeof edge,{...edge,id:'other',toNodeId:'n3'}]});
    const result=await analyzeProjectWithClient(args,deps); const body=JSON.parse(deps.sample.mock.calls[0][0].messages[0].content.text);
    expect(body.typedRelations).toMatchObject({bounded:true,scanLimited:true,omitted:2,edges:[edge]}); expect(JSON.stringify(body)).not.toMatch(/private-worker|metadata|n3/); expect(result).toMatchObject({contextEdgeIds:['e1']});
  });
  it.each(['t2','t1'])('fails closed on an inconsistent reader scope (%s)', async tenantId => {
    const deps=fixture(); deps.readEdges.mockResolvedValue({source:'stored-typed-edges',tenantId,projectId:'p2',bounded:true,scanLimited:false,omitted:0,edges:[edge]});
    await expect(analyzeProjectWithClient(args,deps)).rejects.toThrow('mcp_sampling_invalid_edge_context'); expect(deps.sample).not.toHaveBeenCalled();
  });
  it('does not fall back to node-only sampling on store failure', async () => {
    const deps=fixture(); deps.readEdges.mockRejectedValue(new Error('private-sdk-token'));
    await expect(analyzeProjectWithClient(args,deps)).rejects.toThrow(/^mcp_sampling_edge_context_unavailable$/); expect(deps.sample).not.toHaveBeenCalled();
  });
  it.each(['(zk-edge:bad id)', '(zk-edge:)', '(zk-edge:e1', '(zk:bad id)'])('rejects malformed citation syntax %s', async suffix => {
    const deps=fixture(); deps.sample.mockResolvedValue({content:{type:'text',text:`Recorded (zk:n1) ${suffix}`}});
    await expect(analyzeProjectWithClient(args,deps)).rejects.toThrow('mcp_sampling_invalid_citations');
  });
  it.each(['true',1,null])('rejects non-boolean relation opt-in %j before reads', async includeTypedEdges => {
    const deps=fixture(); await expect(analyzeProjectWithClient({...args,includeTypedEdges},deps)).rejects.toThrow('mcp_sampling_invalid_arguments');
    expect(deps.zk.listNodes).not.toHaveBeenCalled(); expect(deps.readEdges).not.toHaveBeenCalled(); expect(deps.sample).not.toHaveBeenCalled();
  });
  it('does not read relations or sample for foreign project or no nodes', async () => {
    const deps=fixture(); await expect(analyzeProjectWithClient({...args,projectId:'foreign'},deps)).rejects.toThrow('mcp_sampling_project_not_allowed');
    deps.zk.listNodes.mockResolvedValue([]); expect(await analyzeProjectWithClient(args,deps)).toMatchObject({sampled:false});
    expect(deps.readEdges).not.toHaveBeenCalled(); expect(deps.sample).not.toHaveBeenCalled();
  });
  it('fails closed if a reader exceeds the requested candidate contract', async () => {
    const deps=fixture(); deps.readEdges.mockResolvedValue({source:'stored-typed-edges',tenantId:'t1',projectId:'p1',bounded:true,scanLimited:false,omitted:0,edges:Array.from({length:13},(_,i)=>({...edge,id:`e${i}`}))});
    await expect(analyzeProjectWithClient(args,deps)).rejects.toThrow('mcp_sampling_invalid_edge_context'); expect(deps.sample).not.toHaveBeenCalled();
  });
  it('does not send an oversized UTF-8 context to the client model', async () => {
    const deps=fixture(); deps.zk.listNodes.mockResolvedValue(Array.from({length:12},(_,i)=>({id:'字'.repeat(1400)+i,tenantId:'t1',projectId:'p1',type:'NOTE',title:'字'.repeat(200),description:'字'.repeat(1000),tags:[],connections:[]})));
    await expect(analyzeProjectWithClient({...args,includeTypedEdges:false},deps)).rejects.toThrow('mcp_sampling_context_too_large'); expect(deps.sample).not.toHaveBeenCalled();
  });
  it.each([true,false])('rejects unknown edge citations, including node-only mode %s', async includeTypedEdges => {
    const deps=fixture(); deps.sample.mockResolvedValue({content:{type:'text',text:'Stored observation (zk:n1) (zk-edge:invented)'}});
    await expect(analyzeProjectWithClient({...args,includeTypedEdges},deps)).rejects.toThrow('mcp_sampling_invalid_citations');
  });
});
