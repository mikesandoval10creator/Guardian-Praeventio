import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {dispatchSelfHostedAction,getAiProviderStats,__resetProviderStatsForTests} from './providerRouter';
import {geminiCircuit} from '../../server/middleware/geminiCircuit';
import {logger} from '../../utils/logger';
import {SELF_HOSTED_ACTION_SPECS} from './selfHostedActions';
const config={baseUrl:'http://fixture.invalid/v1',model:'fixture',timeoutMs:1000};
beforeEach(()=>{geminiCircuit.__resetForTests();__resetProviderStatsForTests();});
afterEach(()=>{vi.restoreAllMocks();geminiCircuit.__resetForTests();__resetProviderStatsForTests();});
describe('cancelled action dispatch is not a provider failure',()=>{
 it('does not begin inference after an already-started context build settles on a cancelled caller',async()=>{
  let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});const build=vi.spyOn(SELF_HOSTED_ACTION_SPECS.getSafetyAdvice,'build').mockImplementationOnce(async()=>{await gate;return{prompt:'fixture'};});
  const controller=new AbortController();const fetchImpl=vi.fn(async()=>new Response('{"choices":[{"message":{"content":"fixture"}}]}'));const call=dispatchSelfHostedAction('getSafetyAdvice',[{}],{signal:controller.signal,credentialResolver:{resolve:()=>config},fetchImpl});expect(build).toHaveBeenCalledOnce();controller.abort();release();
  expect(await call).toEqual({status:'cancelled'});expect(fetchImpl).not.toHaveBeenCalled();expect(getAiProviderStats().selfhosted).toMatchObject({success:0,failure:0});
 });
 it('does not poison the shared breaker across cancellations and allows a later live request',async()=>{
  vi.spyOn(logger,'info').mockImplementation(()=>undefined);
  for(let i=0;i<6;i++){const controller=new AbortController();const fetchImpl=async()=>{controller.abort();return new Response('{"choices":[{"message":{"content":"late"}}]}');};expect(await dispatchSelfHostedAction('getSafetyAdvice',[{}],{signal:controller.signal,credentialResolver:{resolve:()=>config},fetchImpl})).toEqual({status:'cancelled'});}
  expect(geminiCircuit.isOpen('selfhosted')).toBe(false);expect(getAiProviderStats().selfhosted).toMatchObject({success:0,failure:0});
  expect(await dispatchSelfHostedAction('getSafetyAdvice',[{}],{credentialResolver:{resolve:()=>config},fetchImpl:async()=>new Response('{"choices":[{"message":{"content":"live"}}]}')})).toMatchObject({status:'ok',text:'live'});expect(getAiProviderStats().selfhosted).toMatchObject({success:1,failure:0});
 });
 it('ignores a late completion after caller abort and leaves the shared breaker healthy',async()=>{
  const controller=new AbortController();const info=vi.spyOn(logger,'info').mockImplementation(()=>undefined);const warn=vi.spyOn(logger,'warn').mockImplementation(()=>undefined);
  const fetchImpl=vi.fn(async()=>{controller.abort(new Error('private_reason'));return new Response('{"choices":[{"message":{"content":"late"}}]}');});
  const options={signal:controller.signal,fetchImpl,credentialResolver:{resolve:()=>config},tenantId:'fixture'};
  expect(await dispatchSelfHostedAction('getSafetyAdvice',[{}],options)).toEqual({status:'cancelled'});expect(fetchImpl).toHaveBeenCalledOnce();
  expect(getAiProviderStats().selfhosted).toMatchObject({success:0,failure:0});expect(warn).not.toHaveBeenCalled();expect(info).toHaveBeenCalledWith('[ai.provider] selfhosted_cancelled',{action:'getSafetyAdvice',latencyMs:expect.any(Number),tenant_id:'fixture'});
 });
 it('does not resolve credentials, call a model or change health counters when pre-cancelled',async()=>{
  const controller=new AbortController();controller.abort();const resolve=vi.fn(()=>config);const fetchImpl=vi.fn(async()=>new Response('{"choices":[{"message":{"content":"fixture"}}]}'));
  const options={signal:controller.signal,fetchImpl,credentialResolver:{resolve},tenantId:'fixture'};
  expect(await dispatchSelfHostedAction('getSafetyAdvice',[{}],options)).toEqual({status:'cancelled'});expect(resolve).not.toHaveBeenCalled();expect(fetchImpl).not.toHaveBeenCalled();
  expect(getAiProviderStats().selfhosted).toMatchObject({success:0,failure:0});expect(geminiCircuit.isOpen('selfhosted')).toBe(false);
 });
});
