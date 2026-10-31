import { describe, expect, it, vi } from 'vitest';
import { analyzeProjectWithClient, readAuthorizedProjectContext, type ProjectSamplingRequest } from './projectAnalysis';
import type { ZkNodeRef } from './zettelkastenServer';
const args = {tenantId:'t1',projectId:'p1',question:'Contact privacy.fixture@example.test RUT 12.345.678-9'};
function fixture(text: string) {
  // Deliberately PII-shaped document ID: citations must remain literal. Fixture
  // identifier only; preserving it is NOT an anonymization guarantee.
  const id='record-12345678-9';
  const node:ZkNodeRef={id,tenantId:'t1',projectId:'p1',type:'NOTE',title:text,description:text,tags:[],connections:[]};
  const sample=vi.fn(async (_request:ProjectSamplingRequest)=>({content:{type:'text',text:`Observed record (zk:${id})`}}));
  return {node,deps:{zk:{listAccessibleTenants:async()=>['t1'],listNodes:vi.fn(async()=>[node]),getNode:async()=>null,expandSubgraph:async()=>[]},allowedProjects:[{tenantId:'t1',projectId:'p1'}],sample}};
}
describe('MCP model-bound text uses the canonical redactor',()=>{
  it('minimizes question and free-text records before actual sampling parameters',async()=>{
    const {node,deps}=fixture('Contact privacy.fixture@example.test RUT 12.345.678-9 teléfono +56 9 1234 5678');
    const before=JSON.stringify(node); const result=await analyzeProjectWithClient(args,deps);
    const request=deps.sample.mock.calls[0][0]; const body=JSON.parse(request.messages[0].content.text);
    expect(body.question).toContain('[EMAIL_REDACTED]'); expect(body.question).toContain('[RUT_REDACTED]');
    expect(body.records[0].title).toContain('[EMAIL_REDACTED]'); expect(body.records[0].description).toContain('[PHONE_REDACTED]');
    expect(JSON.stringify(request)).not.toMatch(/privacy\.fixture@example\.test|12\.345\.678-9|1234 5678/);
    expect(body.records[0].id).toBe(node.id); expect(result.contextNodeIds).toEqual([node.id]); expect(result.text).toContain(`(zk:${node.id})`); expect(JSON.stringify(node)).toBe(before);
  });
  it('redacts a token crossing the title/description truncation boundary',async()=>{
    const {deps}=fixture('x'.repeat(194)+' privacy.fixture@example.test');
    const records=await readAuthorizedProjectContext('t1','p1',deps);
    expect(records[0].title).not.toContain('priva');
    expect(records[0].title.length).toBeLessThanOrEqual(200);
    const full='x'.repeat(994)+' privacy.fixture@example.test';deps.zk.listNodes.mockResolvedValue([{...fixture(full).node}]);
    const second=await readAuthorizedProjectContext('t1','p1',deps);
    expect(second[0].description).not.toContain('priva');expect(second[0].description.length).toBeLessThanOrEqual(1000);
  });
  it.each([
    {text:'12.345.678-9',marker:'[RUT_REDACTED]'},
    {text:'privacy.fixture@example.test',marker:'[EMAIL_REDACTED]'},
    {text:'+56 9 1234 5678',marker:'[PHONE_REDACTED]'},
    {text:'4111 1111 1111 1111',marker:'[CARD_REDACTED]'},
    {text:'sk-'+'X'.repeat(30),marker:'[APIKEY_REDACTED]'},
  ])('wires canonical category $marker in every free-text slot',async({text,marker})=>{
    const {node,deps}=fixture('Dato '+text+' observado.');node.type=text;
    await analyzeProjectWithClient({...args,question:'Dato '+text},deps);
    const body=JSON.parse(deps.sample.mock.calls[0][0].messages[0].content.text);
    expect(body.question).toContain(marker);expect(body.records[0].type).toContain(marker);
    expect(body.records[0].title).toContain(marker);expect(body.records[0].description).toContain(marker);
    expect(body.records[0].id).toBe(node.id);
  });
  it('preserves no-PII domain text, Unicode and the existing scope gates',async()=>{
    const text='José informó inspección de válvula; DS 594, folio 12345.';
    const {deps}=fixture(text);await analyzeProjectWithClient({...args,question:text},deps);
    const body=JSON.parse(deps.sample.mock.calls[0][0].messages[0].content.text);
    expect(body.question).toBe(text);expect(body.records[0].title).toBe(text);expect(body.records[0].description).toBe(text);
    deps.sample.mockClear();deps.zk.listNodes.mockClear();
    await expect(analyzeProjectWithClient({...args,projectId:'foreign'},deps)).rejects.toThrow('mcp_sampling_project_not_allowed');
    expect(deps.zk.listNodes).not.toHaveBeenCalled();expect(deps.sample).not.toHaveBeenCalled();
  });
});
