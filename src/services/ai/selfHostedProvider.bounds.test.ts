import {describe,it,expect,vi} from 'vitest';
import {selfHostedChat,SelfHostedProviderError} from './selfHostedProvider';
const LIMIT=256*1024;
const config={baseUrl:'http://fixture.invalid/v1',model:'controlled-model',timeoutMs:1000};
describe('bounded OpenAI-compatible HTTP response',()=>{
 it('preserves Unicode code points split across individual byte chunks',async()=>{
  const text='á漢😀';const bytes=new TextEncoder().encode(JSON.stringify({choices:[{message:{content:text}}]}));let cursor=0;
  const response=new Response(new ReadableStream({pull(controller){if(cursor===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(cursor,++cursor));}},{highWaterMark:0}));
  const result=await selfHostedChat({prompt:'fixture'},{config,fetchImpl:async()=>response});expect(result.text).toBe(text);expect(response.body?.locked).toBe(false);
 });
 it('rejects invalid UTF-8 rather than accepting replacement text',async()=>{
  const prefix=new TextEncoder().encode('{"choices":[{"message":{"content":"');const suffix=new TextEncoder().encode('"}}]}');const bytes=new Uint8Array(prefix.length+1+suffix.length);bytes.set(prefix);bytes[prefix.length]=255;bytes.set(suffix,prefix.length+1);
  await expect(selfHostedChat({prompt:'fixture'},{config,fetchImpl:async()=>new Response(bytes)})).rejects.toMatchObject({code:'selfhosted_bad_response'});
 });
 it.each([{declared:'1'},{declared:'invalid'},{declared:''}])('counts actual UTF-8 bytes rather than trusting a small/missing header %j',async({declared})=>{
  const text='字'.repeat(Math.floor(LIMIT/2));expect(text.length).toBeLessThan(LIMIT);const response=new Response(JSON.stringify({choices:[{message:{content:text}}]}),{headers:declared?{'Content-Length':declared}:{}});
  await expect(selfHostedChat({prompt:'fixture'},{config,fetchImpl:async()=>response})).rejects.toMatchObject({code:'selfhosted_bad_response'});
 });
 it('stops reading at the boundary without waiting for EOF and releases the reader',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({choices:[{message:{content:'x'.repeat(LIMIT)}}]}));let cursor=0;let eof=false;const cancel=vi.fn();
  const response=new Response(new ReadableStream({pull(controller){if(cursor===bytes.length){eof=true;controller.close();return;}const next=Math.min(cursor+32768,bytes.length);controller.enqueue(bytes.slice(cursor,next));cursor=next;},cancel},{highWaterMark:0}));const fetchImpl=vi.fn(async()=>response);
  await expect(selfHostedChat({prompt:'fixture',jsonMode:true},{config,fetchImpl})).rejects.toMatchObject({code:'selfhosted_bad_response'});expect(eof).toBe(false);expect(cancel).toHaveBeenCalledOnce();expect(response.body?.locked).toBe(false);expect(fetchImpl).toHaveBeenCalledOnce();
 });
 it.each([{status:400,jsonMode:true},{status:503,jsonMode:false}])('bounds discarded error-body cancellation without a late retry %j',async({status,jsonMode})=>{
  let release:()=>void=()=>undefined;let finished=false;const cancellation=new Promise<void>(resolve=>{release=()=>{finished=true;resolve();};});const fallback=setTimeout(release,500);
  const fetchImpl=vi.fn(async()=>new Response(new ReadableStream({cancel:()=>cancellation}),{status}));
  try{await expect(selfHostedChat({prompt:'synthetic',jsonMode},{config:{...config,timeoutMs:20},fetchImpl})).rejects.toMatchObject({code:'selfhosted_timeout'});expect(finished).toBe(false);expect(fetchImpl).toHaveBeenCalledOnce();}finally{clearTimeout(fallback);release();await cancellation;}
 });
 it('does not let an uncooperative oversized-body cancellation outlive the original deadline',async()=>{
  let release:()=>void=()=>undefined;let finished=false;const cancellation=new Promise<void>(resolve=>{release=()=>{finished=true;resolve();};});const fallback=setTimeout(release,500);
  const response=new Response(new ReadableStream({cancel:()=>cancellation}),{headers:{'Content-Length':String(LIMIT+1)}});
  try{await expect(selfHostedChat({prompt:'synthetic'},{config:{...config,timeoutMs:20},fetchImpl:async()=>response})).rejects.toMatchObject({code:'selfhosted_timeout'});expect(finished).toBe(false);}finally{clearTimeout(fallback);release();await cancellation;}
 });
 it('rejects a declared oversized response before pulling its body',async()=>{
  const cancel=vi.fn();const pull=vi.fn((controller:ReadableStreamDefaultController<Uint8Array>)=>{controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"small"}}]}'));controller.close();});
  const response=new Response(new ReadableStream({pull,cancel},{highWaterMark:0}),{headers:{'Content-Length':String(LIMIT+1)}});
  const fetchImpl=vi.fn(async()=>response);let code='resolved';try{await selfHostedChat({prompt:'synthetic'},{config,fetchImpl});}catch(error){code=error instanceof SelfHostedProviderError?error.code:'untyped';}
  expect(code).toBe('selfhosted_bad_response');expect(pull).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledOnce();
 });
 it('rejects oversized successful JSON rather than accepting an unbounded completion',async()=>{
  const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'x'.repeat(LIMIT)}}]})));
  let result='resolved';try{await selfHostedChat({prompt:'synthetic request'},{config,fetchImpl});}catch(error){result=error instanceof SelfHostedProviderError?error.code:'untyped_error';}
  expect(result).toBe('selfhosted_bad_response');expect(fetchImpl).toHaveBeenCalledOnce();
 });
});
