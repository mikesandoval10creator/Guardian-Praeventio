import assert from 'node:assert/strict';
import test from 'node:test';
import {invoke,item,sku,otherSku,nextSku,target,other} from './google-play-route-fixture.mjs';
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
