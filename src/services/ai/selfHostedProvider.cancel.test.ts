import {describe,it,expect,vi,afterEach} from 'vitest';
import {selfHostedChat} from './selfHostedProvider';
const config={baseUrl:'http://fixture.invalid/v1',model:'fixture',timeoutMs:1000};
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('caller cancellation of self-hosted completion',()=>{
 it('does not turn cancellation at final reader release into a successful late DTO',async()=>{
  const controller=new AbortController();const response=new Response('{"choices":[{"message":{"content":"late"}}]}');const body=response.body;if(!body)throw new Error('Missing fixture body');const reader=body.getReader();const release=reader.releaseLock.bind(reader);vi.spyOn(reader,'releaseLock').mockImplementation(()=>{release();controller.abort();});vi.spyOn(body,'getReader').mockReturnValue(reader);
  await expect(selfHostedChat({prompt:'synthetic'},{config,signal:controller.signal,fetchImpl:async()=>response})).rejects.toMatchObject({code:'selfhosted_cancelled'});
 });
 it('does not retry JSON mode after the caller cancels during discarded-body cleanup',async()=>{
  const controller=new AbortController();const fetchImpl=vi.fn(async()=>new Response(new ReadableStream({cancel(){controller.abort(new Error('private_cleanup_reason'));}}),{status:400}));
  await expect(selfHostedChat({prompt:'synthetic',jsonMode:true},{config,signal:controller.signal,fetchImpl})).rejects.toMatchObject({code:'selfhosted_cancelled'});expect(fetchImpl).toHaveBeenCalledOnce();
 });
 it('aborts a pending header request without exposing the caller reason',async()=>{
  const controller=new AbortController();let wire:AbortSignal|null|undefined;const fetchImpl=vi.fn(async(_input:unknown,init?:RequestInit)=>{wire=init?.signal;if(!wire)throw new Error('Missing child signal');return new Promise<Response>((_resolve,reject)=>wire?.addEventListener('abort',()=>reject(new DOMException('synthetic','AbortError')),{once:true}));});
  const call=selfHostedChat({prompt:'synthetic'},{config:{...config,timeoutMs:50},signal:controller.signal,fetchImpl});controller.abort(new Error('private_caller_reason'));await expect(call).rejects.toMatchObject({code:'selfhosted_cancelled',message:'selfhosted_cancelled'});expect(String(wire?.reason)).not.toContain('private_caller_reason');
 });
 it('clears deadline and caller listener after successful completion',async()=>{
  vi.useFakeTimers();const controller=new AbortController();const remove=vi.spyOn(controller.signal,'removeEventListener');
  expect((await selfHostedChat({prompt:'synthetic'},{config,signal:controller.signal,fetchImpl:async()=>new Response('{"choices":[{"message":{"content":"fixture"}}]}')})).text).toBe('fixture');expect(vi.getTimerCount()).toBe(0);expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
 });
 it('releases the original caller signal even if its options object is reused',async()=>{
  const original=new AbortController(),replacement=new AbortController();let wire:AbortSignal|null|undefined;
  const fetchImpl=vi.fn(async(_input:unknown,init?:RequestInit)=>{wire=init?.signal;options.signal=replacement.signal;return new Response('{"choices":[{"message":{"content":"fixture"}}]}');});const options={config,fetchImpl,signal:original.signal};
  expect((await selfHostedChat({prompt:'synthetic'},options)).text).toBe('fixture');original.abort();expect(wire?.aborted).toBe(false);
 });
 it('cancels an in-flight body rather than waiting for or reporting a provider timeout',async()=>{
  const controller=new AbortController();const cancel=vi.fn();const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"choices":'));},cancel}));
  const fetchImpl=vi.fn(async()=>response);const call=selfHostedChat({prompt:'synthetic'},{config:{...config,timeoutMs:50},fetchImpl,signal:controller.signal});controller.abort(new Error('private_caller_reason'));
  await expect(call).rejects.toMatchObject({code:'selfhosted_cancelled',message:'selfhosted_cancelled'});expect(cancel).toHaveBeenCalledOnce();expect(response.body?.locked).toBe(false);
 });
 it('does not start a request when the caller is already cancelled',async()=>{
  const controller=new AbortController();controller.abort(new Error('private_reason_not_for_logs'));
  const fetchImpl=vi.fn(async()=>new Response('{"choices":[{"message":{"content":"fixture"}}]}'));const options={config,fetchImpl,signal:controller.signal};
  await expect(selfHostedChat({prompt:'synthetic'},options)).rejects.toMatchObject({code:'selfhosted_cancelled',message:'selfhosted_cancelled'});expect(fetchImpl).not.toHaveBeenCalled();
 });
});
