import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const H=vi.hoisted(()=>({headers:vi.fn(async()=>({'X-Fixture-Uid':'fixture'})),error:vi.fn()}));
vi.mock('./firebase',()=>({auth:{currentUser:{uid:'fixture'}}}));
vi.mock('../lib/apiAuth',()=>({apiAuthHeaders:H.headers}));
vi.mock('../utils/logger',()=>({logger:{error:H.error}}));
import {getChatResponse,semanticSearch,syncBatchToNetwork} from './geminiService';
const fetchMock=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response(JSON.stringify({result:'fixture'}),{headers:{'Content-Type':'application/json'}}));
beforeEach(()=>{H.headers.mockClear();H.error.mockClear();fetchMock.mockClear();vi.stubGlobal('fetch',fetchMock);});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('opt-in UI RPC caller cancellation',()=>{
 it('keeps durable sync callers opt-out with their original payload',async()=>{
  const operations=[{id:'fixture-operation'}];await syncBatchToNetwork(operations);const init=fetchMock.mock.calls[0]?.[1];expect(init).not.toHaveProperty('signal');expect(JSON.parse(String(init?.body))).toEqual({action:'syncBatchToNetwork',args:[operations,'fixture']});
 });
 it('keeps the original optional positional defaults without adding a signal',async()=>{
  await semanticSearch('fixture',[]);const init=fetchMock.mock.calls[0]?.[1];expect(init).not.toHaveProperty('signal');expect(JSON.parse(String(init?.body))).toEqual({action:'semanticSearch',args:['fixture',[],3,null]});
 });
 it('does not suppress genuine live HTTP failures',async()=>{
  fetchMock.mockResolvedValueOnce(new Response('',{status:503,statusText:'Service Unavailable'}));await expect(getChatResponse('fixture','context')).rejects.toThrow('API error: Service Unavailable');expect(H.error).toHaveBeenCalledOnce();
 });
 it('passes cancellation separately for the preceding retrieval without changing its tuple',async()=>{
  const caller=new AbortController();fetchMock.mockResolvedValueOnce(new Response('{"result":[]}'));expect(await semanticSearch('fixture',[],5,'project-fixture',{signal:caller.signal})).toEqual([]);const init=fetchMock.mock.calls[0]?.[1];expect(init?.signal).toBe(caller.signal);expect(JSON.parse(String(init?.body))).toEqual({action:'semanticSearch',args:['fixture',[],5,'project-fixture']});
 });
 it('rejects a late JSON result after caller cancellation',async()=>{
  const caller=new AbortController();const response=new Response('{}');vi.spyOn(response,'json').mockImplementationOnce(async()=>{caller.abort(new Error('private_json_reason'));return{result:'late'};});fetchMock.mockResolvedValueOnce(response);
  await expect(getChatResponse('fixture','context',[],1,'general',{signal:caller.signal})).rejects.toMatchObject({name:'AbortError',message:'Solicitud cancelada.'});expect(H.error).not.toHaveBeenCalled();
 });
 it('does not fetch or log a private reason after cancellation during auth',async()=>{
  const caller=new AbortController();let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});H.headers.mockImplementationOnce(async()=>{await gate;return{'X-Fixture-Uid':'fixture'};});const call=getChatResponse('fixture','context',[],1,'general',{signal:caller.signal});caller.abort(new Error('private_auth_reason'));release();await expect(call).rejects.toMatchObject({name:'AbortError',message:'Solicitud cancelada.'});expect(fetchMock).not.toHaveBeenCalled();expect(H.error).not.toHaveBeenCalled();
 });
 it('passes the original signal to fetch without serializing transport options',async()=>{
  const caller=new AbortController();expect(await getChatResponse('fixture','context',[],2,'sst',{signal:caller.signal})).toBe('fixture');const init=fetchMock.mock.calls[0]?.[1];expect(init?.signal).toBe(caller.signal);expect(JSON.parse(String(init?.body))).toEqual({action:'getChatResponse',args:['fixture','context',[],2,'sst']});
 });
 it('does not authenticate or fetch for a pre-cancelled text request',async()=>{
  const caller=new AbortController();caller.abort(new Error('private_reason'));await expect(getChatResponse('fixture','context',[],1,'general',{signal:caller.signal})).rejects.toMatchObject({name:'AbortError'});expect(H.headers).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();expect(H.error).not.toHaveBeenCalled();
 });
});
