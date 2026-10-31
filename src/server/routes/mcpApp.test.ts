import { describe, expect, it, vi } from 'vitest';
import express, {type Request,type Response,type NextFunction} from 'express';
import request from 'supertest';
import type {AdminFirestoreLike,AdminCollectionLike} from '../mcp/zkFirebaseReadAdapter';
vi.mock('../middleware/verifyAuth.js',()=>({verifyAuth:(req:Request,res:Response,next:NextFunction)=>{if(req.header('authorization')!=='Bearer fixture-u1')return void res.status(401).json({error:'unauthorized'});req.user={uid:'u1'} as Request['user'];next();}}));
import {createMcpAppRouter} from './mcpApp';
import {authorizeAppMcp} from '../mcp/appMcpBridge';
function fixture(projectGate?:Promise<void>){
 const docs:Record<string,Record<string,unknown>>={
  'projects/p1':{tenantId:'t1',members:['u1']},'projects/foreign':{tenantId:'t2',members:['other']},
  'tenants/t1/zettelkasten_nodes/n1':{tenantId:'t1',projectId:'p1',type:'NOTE',title:'Inspection',description:'Synthetic record'},
  'tenants/t1/zettelkasten_nodes/n2':{tenantId:'t1',projectId:'p1',type:'NOTE',title:'Control',description:'Synthetic control'},
  'tenants/t1/zettelkasten_edges/e1':{id:'e1',tenantId:'t1',projectId:'p1',fromNodeId:'n1',toNodeId:'n2',type:'mitigates',inverseType:'mitigated_by'},
 };
 const reads:string[]=[];
 function collection(path:string,filters:Array<[string,unknown]>=[],limit=Infinity):AdminCollectionLike{return{
  doc(id){const p=path+'/'+id;return{id,async get(){reads.push(p);if(p.startsWith('projects/')&&projectGate)await projectGate;return{id,exists:!!docs[p],data:()=>docs[p]};},collection:name=>collection(p+'/'+name)};},
  where(field,op,value){if(op!=='==')throw new Error('unexpected query');return collection(path,[...filters,[field,value]],limit);},
  limit(n){return collection(path,filters,n);},
  async get(){reads.push(path);return{docs:Object.entries(docs).filter(([p,d])=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/')&&filters.every(([f,v])=>d[f]===v)).slice(0,limit).map(([p,d])=>({id:p.split('/').at(-1)!,exists:true,data:()=>d}))};},
 };}
 const db:AdminFirestoreLike={collection};const retrieve=vi.fn(async()=>({method:'lexical' as const,matches:[],scanLimited:false,reason:'no_match' as const}));const audit=vi.fn(async()=>true);
 const app=express();app.use(express.json());app.use('/api/mcp',createMcpAppRouter({getDb:()=>db,retrieveNormative:retrieve,audit}));
 const call=(body:object)=>request(app).post('/api/mcp/project').set('Authorization','Bearer fixture-u1').send(body);
 return{app,call,reads,docs,retrieve,audit,db};
}
describe('authenticated application → actual MCP SDK bridge',()=>{
 it.each([
  ['guardian.getChatResponse','["Resume los registros disponibles"]'],
  ['guardian.queryBCN','["DS 44"]'],
  ['guardian.getSafetyAdvice','[{}]'],
  ['guardian.calculateStructuralLoad','["material sintético","condiciones sintéticas"]'],
  ['guardian.designHazmatStorage','["material sintético",1,"condiciones sintéticas"]'],
  ['guardian.evaluateMinsalCompliance','["situación sintética"]'],
 ])('prepares %s with the actual shared builder',async(name,input)=>{
  const h=fixture();const r=await h.call({projectId:'p1',action:'preparePrompt',name,input,contextApproved:true});
  expect(r.status).toBe(200);expect(r.body.result.messages[0].content.text).toContain('SOLO CONSULTIVO');
  expect(h.reads.filter(p=>p==='projects/p1')).toHaveLength(1);
 });
 it('rejects contradictory token tenant and keeps audit failure explicit',async()=>{
  const h=fixture();await expect(authorizeAppMcp(h.db,'u1','p1','other')).rejects.toThrow('scope denied');
  h.audit.mockResolvedValueOnce(false);const r=await h.call({projectId:'p1',action:'searchNormative',query:'DS 44'});
  expect(r.status).toBe(200);expect(r.body.auditRecorded).toBe(false);
  expect(h.audit).toHaveBeenCalledWith(expect.anything(),'mcp.app.read','mcp',{operation:'searchNormative',mode:'internal-read-only'},{projectId:'p1'});
 });
 it('sanitizes a failed tool and rejects invalid prompt input without fallback',async()=>{
  const h=fixture();h.retrieve.mockRejectedValue(new Error('private-path-token'));
  const failed=await h.call({projectId:'p1',action:'searchNormative',query:'DS 44'});
  expect(failed.status).toBe(503);expect(JSON.stringify(failed.body)).not.toContain('private-path-token');
  const bad=await h.call({projectId:'p1',action:'preparePrompt',name:'guardian.queryBCN',input:'[]',contextApproved:true});expect(bad.status).toBe(400);
 });
 it('honors server kill switch and rejects oversized decoded JSON before project reads',async()=>{
  const h=fixture();try{vi.stubEnv('PRAEVENTIO_MCP_APP_DISABLED','1');expect((await h.call({projectId:'p1',action:'catalog'})).status).toBe(503);}finally{vi.unstubAllEnvs();}
  expect((await h.call({projectId:'p1',action:'preparePrompt',name:'guardian.queryBCN',input:JSON.stringify(['字'.repeat(11000)]),contextApproved:true})).status).toBe(400);expect(h.reads).toEqual([]);
 });
 it('holds the slot while a real SDK tool callback outlives client timeout',async()=>{
  const h=fixture();let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});
  h.retrieve.mockImplementationOnce(async()=>{await gate;return{method:'lexical',matches:[],scanLimited:false,reason:'no_match'};});
  try{expect((await h.call({projectId:'p1',action:'searchNormative',query:'DS 44'})).status).toBe(503);expect((await h.call({projectId:'p1',action:'catalog'})).status).toBe(429);}finally{release();}
  await new Promise(resolve=>setTimeout(resolve,25));expect((await h.call({projectId:'p1',action:'catalog'})).status).toBe(200);
 });
 it('keeps a stalled authorization busy after the real deadline until work settles',async()=>{
  let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});const h=fixture(gate);
  try{const r=await h.call({projectId:'p1',action:'catalog'});expect(r.status).toBe(503);expect(r.body.error).toBe('mcp_deadline');expect((await h.call({projectId:'p1',action:'catalog'})).status).toBe(429);}finally{release();}
  await new Promise(resolve=>setTimeout(resolve,25));expect((await h.call({projectId:'p1',action:'catalog'})).status).toBe(200);
 });
 it('requires auth before any read',async()=>{const h=fixture();expect((await request(h.app).post('/api/mcp/project').send({projectId:'p1',action:'catalog'})).status).toBe(401);expect(h.reads).toEqual([]);});
 it('discovers real supported tools and all existing prompts without sampling',async()=>{const h=fixture();const r=await h.call({projectId:'p1',action:'catalog'});expect(r.status).toBe(200);expect(r.body.protocol).toBe('mcp-sdk');expect(r.body.result.tools.map((x:{name:string})=>x.name).sort()).toEqual(['legal.searchNormative','zk.listEdges','zk.listNodes']);expect(r.body.result.prompts).toHaveLength(6);expect(h.audit).toHaveBeenCalledOnce();});
 it('denies foreign project before constructing/reading MCP resources',async()=>{const h=fixture();const r=await h.call({projectId:'foreign',action:'listRecords'});expect(r.status).toBe(403);expect(h.reads).toEqual(['projects/foreign']);expect(h.retrieve).not.toHaveBeenCalled();});
 it('runs records, relations and normative tool over SDK with literal project scope',async()=>{const h=fixture();const records=await h.call({projectId:'p1',action:'listRecords'});expect(records.status).toBe(200);expect(records.body.result.nodes).toHaveLength(2);expect(records.body.result.nodes[0].connections).toEqual([]);const edges=await h.call({projectId:'p1',action:'listRelations'});expect(edges.status).toBe(200);expect(edges.body.result.edges[0].id).toBe('e1');const law=await h.call({projectId:'p1',action:'searchNormative',query:'DS 44'});expect(law.status).toBe(200);expect(law.body.result.reason).toBe('no_match');expect(h.retrieve).toHaveBeenCalledExactlyOnceWith('DS 44');});
 it('prepares an actual existing prompt only after explicit context confirmation',async()=>{const h=fixture();expect((await h.call({projectId:'p1',action:'preparePrompt',name:'guardian.queryBCN',input:'["DS 44"]',contextApproved:false})).status).toBe(400);const r=await h.call({projectId:'p1',action:'preparePrompt',name:'guardian.queryBCN',input:'["DS 44"]',contextApproved:true});expect(r.status).toBe(200);expect(r.body.result.messages[0].content.text).toContain('SOLO CONSULTIVO');expect(r.body.result.messages[0].content.text).toContain('n1');});
 it.each([{projectId:'p1',action:'listRecords',tenantId:'t2'},{projectId:'../p1',action:'catalog'},{projectId:'p1',action:'tools/call',name:'writeNode'},{projectId:'p1',action:'catalog',url:'http://localhost'},{projectId:'p1',action:'searchNormative',query:'x'}])('rejects payload/scope/URL injection %j',async body=>{const h=fixture();expect((await h.call(body)).status).toBe(400);expect(h.reads).toEqual([]);});
 it('fails closed on an unstamped tenant project and sanitizes infrastructure failures',async()=>{const h=fixture();delete h.docs['projects/p1'].tenantId;expect((await h.call({projectId:'p1',action:'listRecords'})).status).toBe(409);});
 it('enforces six per-user attempts across fresh SDK sessions',async()=>{const h=fixture();for(let i=0;i<6;i++)expect((await h.call({projectId:'p1',action:'catalog'})).status).toBe(200);expect((await h.call({projectId:'p1',action:'catalog'})).status).toBe(429);});
});
