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
 export function create(scope,path){const {playAuth,playDeveloperApi,getFirestore,FieldValue,logger,sentryCapture,ALL_IAP_SKUS,planFromIapProductId,cycleFromProductId,auditServerEvent,withIdempotency,safeSecretEqual,process,Date}=scope;
 return path==='/verify'?${handlers.get('/verify')}:${handlers.get('/webhook')};}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {create}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const pricingSource=['iapSkus.ts','subscriptionPlan.ts'].map(file=>readFileSync(new URL('../src/services/pricing/'+file,import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'')).join('\n');
const pricingOutput=ts.transpileModule('const TIERS=[];\n'+pricingSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {ALL_IAP_SKUS,planFromIapProductId,cycleFromProductId}=await import(`data:text/javascript;base64,${Buffer.from(pricingOutput).toString('base64')}`);
const sku='praeventio_cobre_monthly', otherSku='praeventio_oro_monthly',nextSku='praeventio_plata_monthly';
const item=(productId,expiryTime,extra={})=>({productId,expiryTime,latestSuccessfulOrderId:`dummy-${productId}-order`,...extra});
const target=item(sku,'2030-01-02T00:00:00Z'),other=item(otherSku,'2035-01-01T00:00:00Z');
async function invoke(path,lineItems,requested=sku,stored=sku){
 const transactions=[],updates=[],events=[]; const doc={id:'dummy-user',data:()=>({subscription:stored!==null&&typeof stored==='object'?stored:{productId:stored}}),ref:{update:async value=>updates.push(value)}};
 const db={collection(name){if(name==='transactions')return {add:async value=>transactions.push(value)};
  assert.equal(name,'users');return {doc:()=>({update:async value=>updates.push(value)}),where:()=>({get:async()=>({empty:false,docs:[doc]})})};}};
 const data={subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',lineItems};
 const scope={Date:class extends globalThis.Date {static now(){return globalThis.Date.parse('2030-01-01T00:00:00Z');}},playAuth:{},playDeveloperApi:{purchases:{subscriptionsv2:{get:async()=>({data})}}},getFirestore:()=>db,FieldValue:{serverTimestamp:()=> 'dummy-time'},logger:{info(){},warn(){},error(...args){events.push(args);}},sentryCapture(){},
  ALL_IAP_SKUS,planFromIapProductId,cycleFromProductId,auditServerEvent:async()=>true,
  withIdempotency:async(db,options,work)=>({kind:'fresh-success',result:await work()}),safeSecretEqual:(a,b)=>a===b,process:{env:{GOOGLE_PLAY_PACKAGE_NAME:'dummy.package',WEBHOOK_SECRET:'dummy-secret',NODE_ENV:'production'}}};
 const req={user:{uid:'dummy-user'},query:{token:'dummy-secret'},body:path==='/verify'?{purchaseToken:'dummy-token',productId:requested,type:'subscription'}:{message:{messageId:'dummy-message',data:Buffer.from(JSON.stringify({packageName:'dummy.package',subscriptionNotification:{version:'1.0',notificationType:2,purchaseToken:'dummy-token'}})).toString('base64')}}};
 const res={code:200,body:null,status(code){this.code=code;return this;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};
 await create(scope,path)(req,res);return {res,transactions,updates,events};
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
test('verify rejects an unregistered deferred target before transaction or entitlement writes',async()=>{
 const unknown='unregistered-sku';const current=item(sku,target.expiryTime,{deferredItemReplacement:{productId:unknown}});
 const result=await invoke('/verify',[current,item(unknown,undefined)],unknown);
 assert.equal(result.res.code,400);assert.equal(result.res.body.error,'unknown_product');assert.equal(result.transactions.length,0);assert.equal(result.updates.length,0);
 assert.ok(result.events.some(event=>event[0]==='iap_unknown_product'));
});
test('RTDN never falls back to an expired known item when the live item is unknown',async()=>{
 const result=await invoke('/webhook',[item(sku,'2020-01-01T00:00:00Z'),item('unregistered-sku','2031-01-01T00:00:00Z')]);
 assert.equal(result.res.code,500);assert.equal(result.updates.length,0);assert.ok(result.events.some(event=>event[0]==='rtdn_webhook_failed'));
});
test('RTDN reconciles legacy subscriptions using an unambiguous persisted plan and cycle',async()=>{
 const result=await invoke('/webhook',[other,target],sku,{planId:'cobre',cycle:'monthly'});
 assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.productId'],sku);
});
test('RTDN does not infer a SKU from incomplete or contradictory legacy hints',async()=>{
 for(const stored of [{planId:'cobre'}, {planId:'cobre',cycle:'annual'}, {productId:'stale-sku',planId:'cobre',cycle:'monthly'}]){
  const result=await invoke('/webhook',[other,target],sku,stored);
  assert.equal(result.res.code,500);assert.equal(result.updates.length,0);
 }
});
test('the native receipt grant persists its verified SKU for the following RTDN',async()=>{
 const receiptSource=ts.createSourceFile('iapReceipts.ts',readFileSync(new URL('../src/server/routes/billing/iapReceipts.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const grants=[];
 function visitReceipt(node){
  if(ts.isObjectLiteralExpression(node)&&node.properties.some(property=>ts.isPropertyAssignment(property)&&ts.isStringLiteral(property.name)&&property.name.text==='subscription.provider'&&property.initializer.getText(receiptSource)==="'google-play'"))grants.push(node.getText(receiptSource));
  ts.forEachChild(node,visitReceipt);
 }
 visitReceipt(receiptSource);assert.equal(grants.length,1);
 const {outputText}=ts.transpileModule(`export function grant(success){const resolvedPlan='cobre',resolvedCycle='monthly',receiptId='dummy-token';const FieldValue={serverTimestamp:()=> 'dummy-time'};return ${grants[0]};}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
 const {grant}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
 const payload=grant({productId:sku,expiryMs:globalThis.Date.parse(target.expiryTime)});
 const result=await invoke('/webhook',[other,target],sku,payload['subscription.productId']??null);
 assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.productId'],sku);
});

test('store boundaries reject plan aliases and inherited catalog properties',async()=>{
 for(const unknown of ['oro','premium','ilimitado','gratis','toString','constructor','__proto__']){
  const current=item(sku,target.expiryTime,{deferredItemReplacement:{productId:unknown}});
  const verified=await invoke('/verify',[current,item(unknown,undefined)],unknown);
  assert.equal(verified.res.code,400,unknown);assert.equal(verified.transactions.length,0);assert.equal(verified.updates.length,0);
  const notified=await invoke('/webhook',[item(sku,'2020-01-01T00:00:00Z'),item(unknown,'2031-01-01T00:00:00Z')]);
  assert.equal(notified.res.code,500,unknown);assert.equal(notified.updates.length,0);
 }
});

test('verify rejects an unregistered current SKU linked to a canonical deferred target',async()=>{
 for(const unknown of ['premium','oro','unregistered-sku']){
  const current=item(unknown,target.expiryTime,{deferredItemReplacement:{productId:nextSku}});
  const result=await invoke('/verify',[current,item(nextSku,undefined)],nextSku);
  assert.equal(result.res.code,400,unknown);assert.equal(result.transactions.length,0);assert.equal(result.updates.length,0);
 }
});
