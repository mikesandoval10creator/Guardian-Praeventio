import assert from 'node:assert/strict';
import test from 'node:test';
import {invoke,item,sku,target} from './google-play-route-fixture.mjs';
for(const path of ['/verify','/webhook']){
 test(`${path}: canceled subscription retains its remaining paid period`,async()=>{
  const result=await invoke(path,[target],sku,sku,'SUBSCRIPTION_STATE_CANCELED');
  assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.status'],'active');assert.equal(result.updates[0]['subscription.expiryDate'],target.expiryTime);
 });
 test(`${path}: canceled access ends at the expiry boundary`,async()=>{
  for(const expiry of ['2030-01-01T00:00:00Z','2029-12-31T00:00:00Z']){
   const result=await invoke(path,[item(sku,expiry)],sku,sku,'SUBSCRIPTION_STATE_CANCELED');
   assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.status'],'expired');
  }
 });
 test(`${path}: missing canceled expiry never creates an entitlement`,async()=>{
  const result=await invoke(path,[item(sku,undefined)],sku,sku,'SUBSCRIPTION_STATE_CANCELED');
  assert.equal(result.updates.length,0);assert.ok(result.res.code>=400);
 });
 test(`${path}: active/grace and other inactive states preserve their decisions`,async()=>{
  for(const state of ['ACTIVE','IN_GRACE_PERIOD','PENDING','PAUSED','ON_HOLD','EXPIRED','REVOKED','UNSPECIFIED']){
   const result=await invoke(path,[target],sku,sku,`SUBSCRIPTION_STATE_${state}`);
   assert.equal(result.res.code,200);assert.equal(result.updates[0]['subscription.status'],['ACTIVE','IN_GRACE_PERIOD'].includes(state)?'active':'expired');
  }
 });
}
