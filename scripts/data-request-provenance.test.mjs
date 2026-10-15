import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = path => ts.createSourceFile(path, readFileSync(new URL('../'+path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const route = read('src/server/routes/compliance.ts'), service = read('src/services/compliance/ley19628.ts'), tenant = read('src/server/auth/tenantAuthorization.ts');
function declarations(source, names) {
 const found = source.statements.filter(node => (ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)) && names.includes(node.name?.text));
 assert.equal(found.length, names.length); return found.map(node=>node.getText(source).replace(/^export /,'')).join('\n');
}
const handlers = [];
function visit(node) {
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='post'&&node.arguments.length&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/data-request')handlers.push(node.arguments.at(-1).getText(route));
 ts.forEachChild(node,visit);
}
visit(route);assert.equal(handlers.length,1);
const roles = readFileSync(new URL('../src/types/roles.ts', import.meta.url),'utf8').replace(/^export /gm,'');
const output=ts.transpileModule(`export function create(scope){
 const {getAuth,getDb,logger,captureRouteError,auditServerEvent,Date}=scope;
 const REQUESTS_COLLECTION='compliance_data_requests';
 ${roles}
 ${declarations(service,['ComplianceError','computeRegimeAndDeadline','requestDataAccess'])}
 ${declarations(route,['assertAdminCaller'])}
 ${declarations(tenant,['assertTargetInCallerTenant'])}
 const getActiveRegimes=()=>[],strictestDeadlineDays=()=>null,getMostStrictRegime=()=>null;
 return ${handlers[0]};
}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {create}=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
async function invoke({targetUid,reason,role='worker',callerTenant='dummy-tenant',targetTenant='dummy-tenant',unknown=false,authFailure=false,writeFailure=false}={}){
 const rows=[],audits=[],lookups=[];
 const body={requestedByUid:'forged-actor',type:'rectification',rectificationPayload:{displayName:'Dummy corrected'},subjectCountry:'CL',...(targetUid===undefined?{}:{targetUid}),...(reason===undefined?{}:{reason})};
 const req={user:{uid:'dummy-caller',role:'admin',tenantId:'forged-tenant'},body};
 const res={code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 const db={collection(name){assert.equal(name,'compliance_data_requests');return{async add(data){if(writeFailure)throw new Error('dummy write failed');rows.push({...data});return{async get(){return{id:'dummy-request',data:()=>({...data})};}};}};}};
 const handler=create({Date:{now:()=>1000},getDb:()=>db,getAuth:()=>({async getUser(uid){lookups.push(uid);if(authFailure||unknown&&uid==='dummy-target')throw new Error('dummy auth unavailable');return{customClaims:uid==='dummy-caller'?{role,tenantId:callerTenant}:{role:'worker',tenantId:targetTenant}};}}),logger:{info(){},error(){}},captureRouteError(){},auditServerEvent:async(...args)=>audits.push(args)});
 await handler(req,res);return{res,rows,audits,lookups};
}
test('self-service stores the reason, actor and existing request payload',async()=>{
 const r=await invoke({reason:'Dummy reason'});assert.equal(r.res.code,201);assert.equal(r.rows[0].reason,'Dummy reason');assert.equal(r.rows[0].requestedByUid,'dummy-caller');
 assert.equal(r.rows[0].uid,'dummy-caller');assert.deepEqual(r.rows[0].rectificationPayload,{displayName:'Dummy corrected'});assert.equal(r.rows[0].subjectCountry,'CL');assert.equal(r.lookups.length,0);
 assert.equal(r.audits[0][3].reason,'Dummy reason');assert.equal(r.audits[0][3].targetUid,'dummy-caller');
});
test('same-tenant admin and gerente record the target subject and verified caller',async()=>{
 for(const role of ['admin','gerente']){const r=await invoke({targetUid:'dummy-target',reason:'On behalf of subject',role});assert.equal(r.res.code,201);assert.equal(r.rows[0].uid,'dummy-target');assert.equal(r.rows[0].requestedByUid,'dummy-caller');assert.equal(r.res.body.request.uid,'dummy-target');assert.equal(r.audits[0][3].uid,'dummy-caller');assert.equal(r.audits[0][3].targetUid,'dummy-target');}
});
test('forged token admin claims and platform role cannot delegate without server admin authority',async()=>{
 for(const role of ['worker','platform_operator']){const r=await invoke({targetUid:'dummy-target',role});assert.equal(r.res.code,403);assert.deepEqual(r.rows,[]);assert.deepEqual(r.audits,[]);}
});
test('admin cannot create requests for another tenant',async()=>{
 const r=await invoke({targetUid:'dummy-target',role:'admin',targetTenant:'another-tenant'});assert.equal(r.res.code,403);assert.deepEqual(r.rows,[]);assert.deepEqual(r.audits,[]);
});
test('admin without tenant scope cannot delegate',async()=>{
 const denied=await invoke({targetUid:'dummy-target',role:'admin',callerTenant:'',targetTenant:''});assert.equal(denied.res.code,403);assert.deepEqual(denied.rows,[]);
});
test('unknown target and authority lookup failure never create a request',async()=>{
 const unknown=await invoke({targetUid:'dummy-target',role:'admin',unknown:true});assert.equal(unknown.res.code,403);assert.deepEqual(unknown.rows,[]);
 const failure=await invoke({targetUid:'dummy-target',role:'admin',authFailure:true});assert.equal(failure.res.code,500);assert.deepEqual(failure.rows,[]);assert.deepEqual(failure.res.body,{error:'internal_error'});
});
test('explicit self target remains self-service without admin or tenant lookups',async()=>{
 const r=await invoke({targetUid:'dummy-caller',authFailure:true});assert.equal(r.res.code,201);assert.equal(r.rows[0].uid,'dummy-caller');assert.equal(r.lookups.length,0);
});
test('write failure returns error without a successful creation audit',async()=>{
 const r=await invoke({reason:'dummy',writeFailure:true});assert.equal(r.res.code,500);assert.deepEqual(r.rows,[]);assert.deepEqual(r.audits,[]);
});
