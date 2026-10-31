// Application bridge, not an externally exposed MCP HTTP transport. Each
// request owns an SDK client/server pair; neither has model capabilities.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {z} from 'zod';
import {createZettelkastenMcpServer} from '../../services/mcp/zettelkastenStdioAdapter.js';
import {readAuthorizedProjectContext} from '../../services/mcp/projectAnalysis.js';
import type {AppMcpRequest} from '../../services/mcp/appBridgeContract.js';
import type {NormativeRetriever} from '../../services/rag/nativeNormativeContext.js';
import {assertProjectMember,ProjectMembershipError} from '../../services/auth/projectMembership.js';
import {createZkFirebaseReadAdapter,type AdminFirestoreLike} from './zkFirebaseReadAdapter.js';
import {createTypedEdgesReader} from './typedEdgesReader.js';

export class AppMcpError extends Error{
 constructor(readonly code:string,readonly status:number){super(code);}
}
export async function authorizeAppMcp(db:AdminFirestoreLike,uid:string,projectId:string,tokenTenant?:string){
 const snapshot=await db.collection('projects').doc(projectId).get();
 // Same snapshot for membership and tenant: no TOCTOU between two reads and
 // no stale positive custom-claim shortcut for this new read boundary.
 await assertProjectMember(uid,projectId,{collection:()=>({doc:()=>({get:async()=>snapshot})})});
 const data=snapshot.data();const tenantId=data?.tenantId;
 if(typeof tenantId!=='string'||!(/^[A-Za-z0-9_-]{1,200}$/).test(tenantId))throw new AppMcpError('mcp_project_scope_missing',409);
 if(tokenTenant&&tokenTenant!==tenantId)throw new ProjectMembershipError('scope denied');
 return{tenantId,projectId};
}
export async function invokeAppMcp(input:AppMcpRequest,scope:{tenantId:string;projectId:string},db:AdminFirestoreLike,retrieveNormative:NormativeRetriever,signal:AbortSignal){
 signal.throwIfAborted();
 const base=createZkFirebaseReadAdapter({firestore:db,accessibleTenants:[scope.tenantId]});
 const allowedProjects=[scope];
 const zk={
  listAccessibleTenants:async()=>[scope.tenantId],
  getNode:async()=>{throw new Error('unsupported_app_operation');},
  expandSubgraph:async()=>{throw new Error('unsupported_app_operation');},
  listNodes:async()=>{
   const rows=await readAuthorizedProjectContext(scope.tenantId,scope.projectId,{zk:base,allowedProjects});
   return rows.map(row=>({...row,tenantId:scope.tenantId,projectId:scope.projectId,tags:[],connections:[]}));
  },
 };
 const server=createZettelkastenMcpServer({zk,samplingProjects:allowedProjects,retrieveNormative,
  readEdges:createTypedEdgesReader({firestore:db,accessibleTenants:[scope.tenantId],allowedProjects})});
 const client=new Client({name:'guardian-app-read-only',version:'1'},{capabilities:{}});
 const [a,b]=InMemoryTransport.createLinkedPair();
 const options={signal,timeout:12_000};
 try{
  await server.connect(b);signal.throwIfAborted();await client.connect(a,options);signal.throwIfAborted();
  let result:unknown;
  if(input.action==='catalog'){
   const tools=await client.listTools(undefined,options);const prompts=await client.listPrompts(undefined,options);
   result={tools:tools.tools.filter(t=>['zk.listNodes','zk.listEdges','legal.searchNormative'].includes(t.name)),prompts:prompts.prompts};
  }else if(input.action==='preparePrompt'){
   result=await client.getPrompt({name:input.name,arguments:{...scope,input:input.input}},options);
  }else{
   const name=input.action==='listRecords'?'zk.listNodes':input.action==='listRelations'?'zk.listEdges':'legal.searchNormative';
   const args=input.action==='searchNormative'?{tenantId:scope.tenantId,query:input.query}:{...scope,limit:input.action==='listRelations'?25:12};
   const reply=await client.callTool({name,arguments:args},undefined,options);
   if(reply.isError)throw new AppMcpError('mcp_operation_failed',503);
   const checked=z.object({content:z.array(z.object({type:z.literal('text'),text:z.string()})).length(1)}).safeParse(reply);
   if(!checked.success)throw new AppMcpError('mcp_invalid_result',502);
   result=JSON.parse(checked.data.content[0].text);
  }
  signal.throwIfAborted();
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>256*1024)throw new AppMcpError('mcp_result_too_large',502);
  return{protocol:'mcp-sdk' as const,mode:'internal-read-only' as const,action:input.action,
   projection:{nodeLimit:12,adjacency:'omitted',tags:'omitted'},result};
 }catch(error){
  if(error instanceof AppMcpError)throw error;
  // Only an allowlisted marker changes status. Never expose SDK messages,
  // source content, paths, credentials or responses in logs/errors.
  if(error instanceof Error&&error.message.includes('mcp_prompt_invalid_arguments'))throw new AppMcpError('mcp_invalid_prompt_input',400);
  throw new AppMcpError('mcp_operation_failed',503);
 }finally{await Promise.allSettled([client.close(),server.close()]);}
}
