import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=ts.createSourceFile('compliance.ts',readFileSync(new URL('../src/server/routes/compliance.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const handlers=[];let idPattern;
function visit(node){
 if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='REQUEST_ID_REGEX')idPattern=node.initializer.getText(source);
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='post'&&node.arguments.length&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/admin/data-request/:id/erase')handlers.push(node.arguments.at(-1).getText(source));
 ts.forEachChild(node,visit);
}
visit(source);assert.equal(handlers.length,1);assert.ok(idPattern);
const output=ts.transpileModule(`export function create(scope){
 const {scalarRouteParams,assertAdminCaller,assertTargetInCallerTenant,getDataAccessRequest,getDb,auditServerEvent,anonymizeUser,getAuth,getFirestore,eraseUserData,Date,logger,captureRouteError}=scope;
 const REQUESTS_COLLECTION='compliance_data_requests';const REQUEST_ID_REGEX=${idPattern};class ComplianceError extends Error{}
 return ${handlers[0]};
}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {create}=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
function fixture(extra={},fail=false){
 let stored={uid:'dummy-subject',type:'erasure',status:'pending',requestedAt:100,...extra};const calls=[],writes=[];
 const db={collection(name){assert.equal(name,'compliance_data_requests');return{doc(id){assert.equal(id,'dummy-request');return{async set(data,options){assert.equal(stored,undefined,'erasure must remove the old row first');assert.deepEqual(options,{merge:true});assert.ok(Object.values(data).every(v=>v!==undefined));writes.push(data);stored={...data};}};}};}};
 const handler=create({scalarRouteParams:v=>v,assertAdminCaller:async()=>true,assertTargetInCallerTenant:async(res,caller,target)=>{assert.equal(caller,'dummy-admin');assert.equal(target,'dummy-subject');return true;},getDataAccessRequest:async()=>stored?{id:'dummy-request',...stored}:null,getDb:()=>db,getAuth:()=>({}),getFirestore:()=>db,auditServerEvent:async(req,event)=>calls.push(event),anonymizeUser:async()=>{calls.push('anonymize');if(fail)throw new Error('dummy anonymization failure');return{applied:true,fieldsRedacted:[]};},eraseUserData:async(db,uid,options)=>{assert.equal(uid,'dummy-subject');assert.deepEqual(options,{keepLegalRecords:true});calls.push('erase');stored=undefined;return{erased:[],preserved:[]};},Date:{now:()=>200},logger:{error(){}},captureRouteError(){}});
 return{calls,writes,stored:()=>stored,async invoke(){const res={code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({user:{uid:'dummy-admin'},params:{id:'dummy-request'},body:{confirm:'dummy-request'}},res);return res;}};
}
test('erasure preserves the originating actor and reason in storage and response',async()=>{
 const f=fixture({requestedByUid:'dummy-original-actor',reason:'Dummy requested erasure'});const res=await f.invoke();assert.equal(res.code,200);
 assert.equal(f.stored().requestedByUid,'dummy-original-actor');assert.equal(f.stored().reason,'Dummy requested erasure');assert.equal(f.stored().status,'completed');
 assert.deepEqual(res.body.request,{id:'dummy-request',...f.stored()});assert.deepEqual(f.calls,['arco_erasure_started','anonymize','erase','arco_erasure_executed']);
});
test('legacy erasure rows remain valid without manufacturing provenance',async()=>{
 const f=fixture();const res=await f.invoke();assert.equal(res.code,200);assert.equal(Object.hasOwn(f.stored(),'requestedByUid'),false);assert.equal(Object.hasOwn(f.stored(),'reason'),false);
});
test('explicit empty reasons survive completion',async()=>{
 const f=fixture({requestedByUid:'dummy-actor',reason:''});await f.invoke();assert.equal(f.stored().reason,'');assert.equal(f.stored().requestedByUid,'dummy-actor');
});
test('unrelated payloads and unvalidated legacy values are not copied into the rebuilt record',async()=>{
 const f=fixture({requestedByUid:123,reason:{dummy:'not-a-string'},rectificationPayload:{private:'dummy'},exportedToUrl:'dummy-old-url'});await f.invoke();assert.equal(Object.hasOwn(f.stored(),'requestedByUid'),false);assert.equal(Object.hasOwn(f.stored(),'reason'),false);assert.equal(Object.hasOwn(f.stored(),'rectificationPayload'),false);assert.equal(Object.hasOwn(f.stored(),'exportedToUrl'),false);
});
test('completion remains idempotent and retains the original provenance on retry',async()=>{
 const f=fixture({requestedByUid:'dummy-actor',reason:'dummy-reason'});await f.invoke();const second=await f.invoke();assert.equal(second.body.alreadyCompleted,true);assert.equal(second.body.request.requestedByUid,'dummy-actor');assert.equal(f.writes.length,1);assert.equal(f.calls.filter(c=>c==='erase').length,1);
});
test('anonymization failure cannot rebuild a completed request',async()=>{
 const f=fixture({requestedByUid:'dummy-actor',reason:'dummy-reason'},true);const res=await f.invoke();assert.equal(res.code,500);assert.deepEqual(res.body,{error:'internal_error'});assert.equal(f.stored().status,'pending');assert.equal(f.writes.length,0);assert.equal(f.calls.includes('erase'),false);
});
