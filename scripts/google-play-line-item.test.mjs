import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=ts.createSourceFile('googleplay.ts',readFileSync(new URL('../src/server/routes/billing/googleplay.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const handlers=new Map();
function visit(node){
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='post'&&ts.isStringLiteral(node.arguments[0])){
  const path=node.arguments[0].text; const handler=node.arguments.at(-1);
  if(['/verify','/webhook'].includes(path)&&ts.isArrowFunction(handler))handlers.set(path,handler.getText(source));
 }
 ts.forEachChild(node,visit);
}
visit(source); assert.equal(handlers.size,2);
const helperUrl=new URL('../src/services/billing/googlePlayLineItems.ts',import.meta.url);
const helpers=readFileSync(new URL('../src/services/billing/googlePlayExpiry.ts',import.meta.url),'utf8')+(existsSync(helperUrl)?readFileSync(helperUrl,'utf8').replace(/^import .*;\r?$/gm,''):'');
const {outputText}=ts.transpileModule(`${helpers}
 export function create(scope,path){const {playAuth,playDeveloperApi,getFirestore,FieldValue,logger,sentryCapture,planFromIapProductId,cycleFromProductId,auditServerEvent,withIdempotency,safeSecretEqual,process}=scope;
 return path==='/verify'?${handlers.get('/verify')}:${handlers.get('/webhook')};}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {create}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const sku='target-sku', otherSku='other-sku',nextSku='next-sku';
const item=(productId,expiryTime,extra={})=>({productId,expiryTime,latestSuccessfulOrderId:`dummy-${productId}-order`,...extra});
const target=item(sku,'2030-01-02T00:00:00Z'),other=item(otherSku,'2035-01-01T00:00:00Z');
async function invoke(path,lineItems,requested=sku,stored=sku){
 const transactions=[],updates=[]; const doc={id:'dummy-user',data:()=>({subscription:{productId:stored}}),ref:{update:async value=>updates.push(value)}};
 const db={collection(name){if(name==='transactions')return {add:async value=>transactions.push(value)};
  assert.equal(name,'users');return {doc:()=>({update:async value=>updates.push(value)}),where:()=>({get:async()=>({empty:false,docs:[doc]})})};}};
 const data={subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',lineItems};
 const scope={playAuth:{},playDeveloperApi:{purchases:{subscriptionsv2:{get:async()=>({data})}}},getFirestore:()=>db,FieldValue:{serverTimestamp:()=> 'dummy-time'},logger:{info(){},warn(){},error(){}},sentryCapture(){},
  planFromIapProductId:value=>({[sku]:'cobre',[otherSku]:'oro',[nextSku]:'plata'})[value]??null,cycleFromProductId:()=> 'monthly',auditServerEvent:async()=>true,
  withIdempotency:async(db,options,work)=>({kind:'fresh-success',result:await work()}),safeSecretEqual:(a,b)=>a===b,process:{env:{GOOGLE_PLAY_PACKAGE_NAME:'dummy.package',WEBHOOK_SECRET:'dummy-secret',NODE_ENV:'production'}}};
 const req={user:{uid:'dummy-user'},query:{token:'dummy-secret'},body:path==='/verify'?{purchaseToken:'dummy-token',productId:requested,type:'subscription'}:{message:{messageId:'dummy-message',data:Buffer.from(JSON.stringify({packageName:'dummy.package',subscriptionNotification:{version:'1.0',notificationType:2,purchaseToken:'dummy-token'}})).toString('base64')}}};
 const res={code:200,body:null,status(code){this.code=code;return this;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};
 await create(scope,path)(req,res);return {res,transactions,updates};
}
test('verify rejects SKU mismatch with 400 before any verified transaction or entitlement write',async()=>{
 const result=await invoke('/verify',[other]);assert.equal(result.res.code,400);assert.equal(result.transactions.length,0);assert.equal(result.updates.length,0);
});
test('verify derives expiry and transaction order from the exact SKU regardless of order',async()=>{
 for(const lines of [[other,target],[target,other]]){const result=await invoke('/verify',lines);assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.expiryDate'],target.expiryTime);assert.equal(result.transactions[0].orderId,target.latestSuccessfulOrderId);}
});
test('verify preserves the current paid product during a documented deferred replacement',async()=>{
 const current=item(sku,target.expiryTime,{deferredItemReplacement:{productId:nextSku}});
 const result=await invoke('/verify',[current,item(nextSku,undefined)],nextSku);
 assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.planId'],'cobre');assert.equal(result.updates[0]['subscription.expiryDate'],target.expiryTime);
});
test('modern RTDN without subscriptionId reconciles the SKU returned by Google',async()=>{
 const result=await invoke('/webhook',[target]);assert.equal(result.res.code,200);assert.equal(result.updates.length,1);assert.equal(result.updates[0]['subscription.expiryDate'],target.expiryTime);
});
test('RTDN uses the persisted SKU when multiple paid products remain',async()=>{
 const result=await invoke('/webhook',[other,target]);assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.expiryDate'],target.expiryTime);
});
test('RTDN preserves the current paid product during deferred replacement',async()=>{
 const current=item(sku,target.expiryTime,{deferredItemReplacement:{productId:nextSku}});
 const result=await invoke('/webhook',[current,item(nextSku,undefined)]);assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.planId'],'cobre');assert.equal(result.updates[0]['subscription.expiryDate'],target.expiryTime);
});
test('RTDN rejects ambiguous products without overwriting an existing entitlement',async()=>{
 const result=await invoke('/webhook',[other,target],sku,null);assert.equal(result.res.code,500);assert.equal(result.updates.length,0);
});
test('RTDN follows the replacement product once its paid period starts',async()=>{
 const result=await invoke('/webhook',[item(sku,'2020-01-01T00:00:00Z'),item(nextSku,'2031-01-01T00:00:00Z')]);
 assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.planId'],'plata');assert.equal(result.updates[0]['subscription.productId'],nextSku);
});
test('verify never treats an unlinked missing expiry as a deferred entitlement',async()=>{
 const result=await invoke('/verify',[target,item(nextSku,undefined)],nextSku);
 assert.equal(result.res.code,400);assert.equal(result.transactions.length,0);assert.equal(result.updates.length,0);
});
