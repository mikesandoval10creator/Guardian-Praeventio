// Actual loopback HTTP + production dispatcher; no mocked model-client result.
import {createServer,type ServerResponse} from 'node:http';
import {gzipSync} from 'node:zlib';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {selfHostedChat,SelfHostedProviderError,MAX_SELFHOSTED_RESPONSE_BYTES as LIMIT} from './selfHostedProvider';
import {dispatchSelfHostedAction,getAiProviderStats,__resetProviderStatsForTests} from './providerRouter';
import {geminiCircuit} from '../../server/middleware/geminiCircuit';
import {logger} from '../../utils/logger';
const servers:ReturnType<typeof createServer>[]=[];
afterEach(async()=>{vi.unstubAllEnvs();geminiCircuit.__resetForTests();__resetProviderStatsForTests();for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}});
async function upstream(reply:(response:ServerResponse)=>void){
 const server=createServer((req,res)=>{req.resume();reply(res);});servers.push(server);
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing fixture listener');
 return{baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'fixture-model',timeoutMs:2000};
}
const encode=(text:string)=>JSON.stringify({choices:[{message:{content:text}}]});
async function rejectedCode(run:()=>Promise<unknown>){try{await run();return'resolved';}catch(error){return error instanceof SelfHostedProviderError?error.code:'untyped_error';}}
describe('bounded provider response over actual HTTP',()=>{
 it('accepts valid Unicode JSON at the exact decoded byte boundary',async()=>{
  const sample='á漢😀';const overhead=Buffer.byteLength(encode(sample));const text=sample+'x'.repeat(LIMIT-overhead);const body=encode(text);expect(Buffer.byteLength(body)).toBe(LIMIT);
  const config=await upstream(res=>{res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),Connection:'close'});res.end(body);});
  const result=await selfHostedChat({prompt:'fixture'},{config});expect(result.text).toBe(text);
 });
 it('rejects a chunked oversized response and closes locally before upstream EOF',async()=>{
  let closedBeforeEnd=false;
  // Deliberately never end this body: a size rejection must not wait for EOF
  // or race against an arbitrary fixture completion timer.
  const config=await upstream(res=>{res.writeHead(200,{'Content-Type':'application/json',Connection:'close'});res.once('close',()=>{closedBeforeEnd=!res.writableEnded;});res.write('{"choices":[{"message":{"content":"'+'x'.repeat(LIMIT));});
  expect(await rejectedCode(()=>selfHostedChat({prompt:'fixture'},{config}))).toBe('selfhosted_bad_response');await vi.waitFor(()=>expect(closedBeforeEnd).toBe(true));
 });
 it('counts decompressed bytes even when gzip Content-Length is small',async()=>{
  const compressed=gzipSync(encode('x'.repeat(LIMIT)));expect(compressed.byteLength).toBeLessThan(LIMIT);
  const config=await upstream(res=>{res.writeHead(200,{'Content-Type':'application/json','Content-Encoding':'gzip','Content-Length':compressed.byteLength,Connection:'close'});res.end(compressed);});
  expect(await rejectedCode(()=>selfHostedChat({prompt:'fixture'},{config}))).toBe('selfhosted_bad_response');
 });
 it('feeds a bounded failure to the real action dispatcher without false success or Gemini calls',async()=>{
  const config=await upstream(res=>{res.writeHead(200,{'Content-Type':'application/json',Connection:'close'});res.end(encode('x'.repeat(LIMIT)));});
  vi.stubEnv('AI_SELFHOSTED_BASE_URL',config.baseUrl);vi.stubEnv('AI_SELFHOSTED_MODEL',config.model);vi.stubEnv('AI_SELFHOSTED_TIMEOUT_MS','2000');vi.stubEnv('AI_SELFHOSTED_API_KEY','synthetic_not_a_secret');
  geminiCircuit.__resetForTests();__resetProviderStatsForTests();const warn=vi.spyOn(logger,'warn').mockImplementation(()=>undefined);
  try{const result=await dispatchSelfHostedAction('getSafetyAdvice',[{temp:0,uv:0}],{tenantId:'fixture-tenant'});expect(result).toMatchObject({status:'failed',reason:'call_failed'});expect(getAiProviderStats().selfhosted).toMatchObject({failure:1,success:0});expect(getAiProviderStats().gemini).toMatchObject({failure:0,success:0});expect(warn).toHaveBeenCalledOnce();expect(warn).toHaveBeenCalledWith('[ai.provider] selfhosted_call_failed',{action:'getSafetyAdvice',latencyMs:expect.any(Number),code:'selfhosted_bad_response'});expect(JSON.stringify(warn.mock.calls)).not.toContain(config.baseUrl);}finally{warn.mockRestore();}
 });
});
