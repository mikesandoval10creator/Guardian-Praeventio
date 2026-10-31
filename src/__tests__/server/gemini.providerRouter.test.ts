// Integration test for the AI provider layer THROUGH the real /api/gemini
// dispatch route (the single chokepoint for the whitelisted RPCs).
//
// Exercises the REAL router + REAL providerRouter + REAL selfHostedProvider
// (fetch stubbed at the global boundary — no LLM is called):
//   • no AI_SELFHOSTED_* config → legacy Gemini dispatch, fetch NEVER touched,
//   • routed action + endpoint up → 200 served by the self-hosted provider,
//     Gemini handler NOT called,
//   • routed action + endpoint down → internal fallback by default; Gemini
//     generation requires AI_SELFHOSTED_FALLBACK_GEMINI=1 explicitly,
//   • fallback disabled → degraded ladder (RAG → canned) result,
//   • breaker isolation visible at the route: self-hosted failures do not
//     touch the 'gemini' breaker key.
//
// Harness mirrors gemini.router.test.ts (mocked verifyAuth / limiters /
// geminiBackend / observability). geminiSlmFallback is mocked for a
// deterministic ladder tier.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {createServer,request as httpRequest,type Server,type ServerResponse} from 'node:http';

const H = vi.hoisted(() => ({
  assertAllowed: vi.fn(),
  record: vi.fn(),
  chatHandler: vi.fn(),
  slmFallback: vi.fn(),
}));

vi.mock('../../services/geminiBackend.js', () => ({
  assertGeminiAllowed: (...a: unknown[]) => H.assertAllowed(...a),
  recordGeminiOutcome: (...a: unknown[]) => H.record(...a),
  estimateGeminiCostUsd: () => 0.001,
  getChatResponse: (...a: unknown[]) => H.chatHandler(...a),
}));

vi.mock('../../services/gemini/geminiSlmFallback.js', () => ({
  hasServerSlmFallback: (action: string) => action === 'getChatResponse',
  geminiSlmFallback: (...a: unknown[]) => H.slmFallback(...a),
}));

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = { uid, tier: 'bronze' };
    next();
  },
}));
vi.mock('../../server/middleware/limiters.js', () => ({
  geminiLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  geminiGlobalDailyLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  networkSyncLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => true),
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_n: string, _c: unknown, fn: () => unknown) => fn(),
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = {}; } }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
  }),
}));
// RAG used by the self-hosted getChatResponse prompt builder.
vi.mock('../../services/ragService.js', () => ({
  searchRelevantContext: vi.fn(async () => 'CONTEXTO-LEGAL-MOCK'),
  generateIncidentEmbedding: vi.fn(async () => [0.1]),
}));

import geminiRouter from '../../server/routes/gemini.js';
import { geminiCircuit } from '../../server/middleware/geminiCircuit.js';
import { __resetProviderStatsForTests, SELFHOSTED_CIRCUIT_KEY,getAiProviderStats } from '../../services/ai/providerRouter.js';
import {logger} from '../../utils/logger.js';
import * as providerRouting from '../../services/ai/providerRouter.js';

function buildApp(probe?: (res: Response) => void) {
  const app = express();
  app.use(express.json());
  if (probe) app.use((_req, res, next) => { probe(res); next(); });
  app.use('/api', geminiRouter);
  return app;
}
const uid = { 'x-test-uid': 'u1' };

const ENV_KEYS = [
  'AI_SELFHOSTED_BASE_URL',
  'AI_SELFHOSTED_API_KEY',
  'AI_SELFHOSTED_MODEL',
  'AI_SELFHOSTED_TIMEOUT_MS',
  'AI_PROVIDER_DEFAULT',
  'AI_PROVIDER_ACTIONS_SELFHOSTED',
  'AI_PROVIDER_ACTIONS_GEMINI',
  'AI_SELFHOSTED_FALLBACK_GEMINI',
];
const savedEnv: Record<string, string | undefined> = {};

const fetchMock = vi.fn();

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GEMINI_API_KEY = 'test-key-fake';
  geminiCircuit.__resetForTests();
  __resetProviderStatsForTests();

  H.assertAllowed.mockReset().mockResolvedValue(undefined);
  H.record.mockReset().mockResolvedValue(undefined);
  H.chatHandler.mockReset().mockResolvedValue('respuesta-gemini');
  H.slmFallback.mockReset().mockResolvedValue({ text: 'respuesta-ladder', tier: 'zettelkasten', confidence: 0.8 });

  fetchMock.mockReset().mockImplementation(async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: 'respuesta-selfhosted' } }] }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  geminiCircuit.__resetForTests();
});

function enableSelfHosted() {
  process.env.AI_SELFHOSTED_BASE_URL = 'http://localhost:11434';
  process.env.AI_SELFHOSTED_MODEL = 'mimo-7b';
  process.env.AI_PROVIDER_ACTIONS_SELFHOSTED = 'getChatResponse';
}

const send = (app = buildApp()) =>
  request(app).post('/api/gemini').set(uid).send({ action: 'getChatResponse', args: ['hola', 'ctx'] });

describe('POST /api/gemini — provider layer (self-hosted routing)', () => {
  it('treats an internal cancelled result as terminal on a still-writable connection',async()=>{
    enableSelfHosted();process.env.AI_SELFHOSTED_FALLBACK_GEMINI='1';const dispatch=vi.spyOn(providerRouting,'dispatchSelfHostedAction').mockResolvedValueOnce({status:'cancelled'});
    try{const res=await send();expect(res.status).toBe(499);expect(res.body).toEqual({error:'ai_request_cancelled'});expect(fetchMock).not.toHaveBeenCalled();expect(H.chatHandler).not.toHaveBeenCalled();expect(H.slmFallback).not.toHaveBeenCalled();expect(H.record).not.toHaveBeenCalled();}
    finally{dispatch.mockRestore();}
  });
  it('keeps a normal completed POST alive through real HTTP provider completion',async()=>{
    vi.unstubAllGlobals();let path='';const upstream=createServer((req,res)=>{path=req.url??'';req.resume();req.once('end',()=>{res.writeHead(200,{'Content-Type':'application/json',Connection:'close'});res.end('{"choices":[{"message":{"content":"respuesta-sintetica"}}]}');});});await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const address=upstream.address();if(!address||typeof address==='string')throw new Error('No fixture listener');enableSelfHosted();process.env.AI_SELFHOSTED_BASE_URL=`http://127.0.0.1:${address.port}`;process.env.AI_PROVIDER_ACTIONS_SELFHOSTED='getSafetyAdvice';
    try{const res=await request(buildApp()).post('/api/gemini').set(uid).send({action:'getSafetyAdvice',args:[{temp:0,uv:0}]});expect(res.status).toBe(200);expect(res.body).toEqual({result:'respuesta-sintetica'});expect(path).toBe('/v1/chat/completions');expect(H.record).toHaveBeenCalledOnce();expect(getAiProviderStats().selfhosted).toMatchObject({success:1,failure:0});}
    finally{upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
  });
  it('does not start an opted-in Google fallback if the caller closes during its quota lookup',async()=>{
    enableSelfHosted();process.env.AI_SELFHOSTED_FALLBACK_GEMINI='1';fetchMock.mockResolvedValueOnce(new Response('fixture failure',{status:503}));let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});H.assertAllowed.mockResolvedValueOnce(undefined).mockImplementationOnce(()=>gate);let closed=false;
    const server=createServer(buildApp(res=>res.once('close',()=>{closed=true;})));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No fixture listener');
    const body=JSON.stringify({action:'getChatResponse',args:['fixture','context']});const client=httpRequest(`http://127.0.0.1:${address.port}/api/gemini`,{method:'POST',headers:{...uid,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>res.resume());client.on('error',()=>undefined);client.end(body);
    try{await vi.waitFor(()=>expect(H.assertAllowed).toHaveBeenCalledTimes(2));client.destroy();await vi.waitFor(()=>expect(closed).toBe(true));release();await new Promise<void>(resolve=>setImmediate(resolve));expect(H.chatHandler).not.toHaveBeenCalled();expect(H.slmFallback).not.toHaveBeenCalled();expect(H.record).not.toHaveBeenCalled();}
    finally{release();client.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('propagates a real API client disconnect to the actual upstream HTTP body without fallback',async()=>{
    vi.unstubAllGlobals();vi.mocked(logger.info).mockClear();let upstreamResponse:ServerResponse|undefined;let closedBeforeEnd=false;
    const upstream=createServer((req,res)=>{req.resume();upstreamResponse=res;res.writeHead(200,{'Content-Type':'application/json'});res.once('close',()=>{closedBeforeEnd=!res.writableEnded;});res.write('{"choices":[{"message":{"content":"fixture');});
    const writes:unknown[]=[];const api=createServer(buildApp(res=>{const json=res.json.bind(res);res.json=(body:unknown)=>{writes.push(body);return json(body);};}));
    const listen=async(server:Server)=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No fixture listener');return`http://127.0.0.1:${address.port}`;};
    const base=await listen(upstream);const apiBase=await listen(api);enableSelfHosted();process.env.AI_SELFHOSTED_BASE_URL=base;process.env.AI_SELFHOSTED_TIMEOUT_MS='10000';process.env.AI_PROVIDER_ACTIONS_SELFHOSTED='getSafetyAdvice';process.env.AI_SELFHOSTED_FALLBACK_GEMINI='1';
    const body=JSON.stringify({action:'getSafetyAdvice',args:[{temp:0,uv:0}]});const client=httpRequest(apiBase+'/api/gemini',{method:'POST',headers:{...uid,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>res.resume());client.on('error',()=>undefined);client.end(body);
    try{
      await vi.waitFor(()=>expect(upstreamResponse).toBeDefined());client.destroy();await vi.waitFor(()=>expect(closedBeforeEnd).toBe(true));
      await vi.waitFor(()=>expect(vi.mocked(logger.info).mock.calls.some(([message])=>message==='[ai.provider] selfhosted_cancelled')).toBe(true));
      expect(writes).toEqual([]);expect(H.assertAllowed).toHaveBeenCalledOnce();expect(H.chatHandler).not.toHaveBeenCalled();expect(H.slmFallback).not.toHaveBeenCalled();expect(H.record).not.toHaveBeenCalled();expect(getAiProviderStats().selfhosted).toMatchObject({success:0,failure:0});
    }finally{
      client.destroy();upstreamResponse?.end('"}}]}');
      try{await vi.waitFor(()=>expect(vi.mocked(logger.info).mock.calls.some(([message])=>message==='[ai.provider] selfhosted_cancelled'||message==='[ai.provider] call')).toBe(true));}
      finally{api.closeAllConnections();upstream.closeAllConnections();await Promise.all([api,upstream].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));}
    }
  });
  it('NO config → legacy Gemini dispatch, self-hosted endpoint never contacted (byte-identical)', async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-gemini' });
    expect(H.chatHandler).toHaveBeenCalledWith('hola', 'ctx');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routed action + endpoint up → 200 from the self-hosted provider, Gemini handler NOT called', async () => {
    enableSelfHosted();
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-selfhosted' });
    expect(H.chatHandler).not.toHaveBeenCalled();
    // The OpenAI-compatible endpoint received the chat-completions call.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('mimo-7b');
    expect(body.messages.at(-1).content).toContain('hola');
    // Gate ran on the ISOLATED selfhosted circuit key, accounted at cost 0.
    expect(H.assertAllowed).toHaveBeenCalledWith('u1', 'bronze', SELFHOSTED_CIRCUIT_KEY);
    expect(H.record).toHaveBeenCalledWith(
      'u1',
      'success',
      expect.objectContaining({ costUsd: 0, circuitKey: SELFHOSTED_CIRCUIT_KEY }),
    );
  });

  it('an action NOT in the selfhosted list keeps using Gemini even with config present', async () => {
    enableSelfHosted();
    process.env.AI_PROVIDER_ACTIONS_SELFHOSTED = 'queryBCN'; // different action
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-gemini' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('endpoint DOWN + explicit legacy fallback opt-in → Gemini handler', async () => {
    enableSelfHosted();
    process.env.AI_SELFHOSTED_FALLBACK_GEMINI = '1';
    fetchMock.mockRejectedValue(new TypeError('connect ECONNREFUSED'));
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-gemini' });
    expect(H.chatHandler).toHaveBeenCalledWith('hola', 'ctx');
    // Self-hosted failure recorded on ITS key only — gemini key untouched.
    expect(geminiCircuit.getState(SELFHOSTED_CIRCUIT_KEY)).toBe('closed'); // 1 failure < threshold
    expect(geminiCircuit.getState('gemini')).toBe('closed');
  });

  it('endpoint DOWN + AI_SELFHOSTED_FALLBACK_GEMINI=0 → degraded ladder result (RAG → canned), no Gemini call', async () => {
    enableSelfHosted();
    process.env.AI_SELFHOSTED_FALLBACK_GEMINI = '0';
    fetchMock.mockRejectedValue(new TypeError('connect ECONNREFUSED'));
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-ladder', degraded: true, fallbackTier: 'zettelkasten' });
    expect(H.chatHandler).not.toHaveBeenCalled();
  });

  it('endpoint DOWN + fallback disabled + no ladder for the action → 503 without internals', async () => {
    process.env.AI_SELFHOSTED_BASE_URL = 'http://localhost:11434';
    process.env.AI_SELFHOSTED_MODEL = 'mimo-7b';
    process.env.AI_PROVIDER_ACTIONS_SELFHOSTED = 'getSafetyAdvice';
    process.env.AI_SELFHOSTED_FALLBACK_GEMINI = '0';
    fetchMock.mockRejectedValue(new TypeError('connect ECONNREFUSED 127.0.0.1:11434'));
    const res = await request(buildApp())
      .post('/api/gemini')
      .set(uid)
      .send({ action: 'getSafetyAdvice', args: [{ temp: 30, uv: 8 }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('selfhosted_unavailable');
    expect(JSON.stringify(res.body)).not.toContain('11434');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('open SELF-HOSTED breaker + explicit fallback opt-in → Gemini', async () => {
    enableSelfHosted();
    process.env.AI_SELFHOSTED_FALLBACK_GEMINI = '1';
    for (let i = 0; i < geminiCircuit.THRESHOLD; i++) {
      geminiCircuit.recordFailure(SELFHOSTED_CIRCUIT_KEY);
    }
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-gemini' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('default failure policy uses only the internal ladder, never the legacy Gemini handler', async () => {
    enableSelfHosted();
    fetchMock.mockRejectedValue(new Error('PRIVATE_UPSTREAM_DETAIL'));
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(H.chatHandler).not.toHaveBeenCalled();
    expect(H.slmFallback).toHaveBeenCalledWith('getChatResponse', ['hola', 'ctx'], { allowRag: false });
    expect(H.assertAllowed).not.toHaveBeenCalledWith('u1', 'bronze');
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE_UPSTREAM_DETAIL');
  });

  it('missing config for an explicitly selected action does not silently authorize Gemini', async () => {
    process.env.AI_PROVIDER_ACTIONS_SELFHOSTED = 'getChatResponse';
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(H.chatHandler).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unsupported but selected action is unavailable, not silently dispatched to Gemini', async () => {
    enableSelfHosted();
    process.env.AI_PROVIDER_ACTIONS_SELFHOSTED = 'generateEmergencyScenario';
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'generateEmergencyScenario', args: [] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('selfhosted_unavailable');
    expect(H.assertAllowed).not.toHaveBeenCalledWith('u1', 'bronze');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the deterministic emergency plan when the selected model cannot serve it', async () => {
    process.env.AI_PROVIDER_ACTIONS_SELFHOSTED = 'generateEmergencyPlanJSON';
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'generateEmergencyPlanJSON', args: ['incendio', 'sitio de prueba', 'DS 594'] });
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.result.generadoSinIA).toBe(true);
    expect(res.body.result.accionesInmediatas.length).toBeGreaterThan(0);
    expect(H.assertAllowed).not.toHaveBeenCalledWith('u1', 'bronze');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a blocked selfhosted gate also respects default no-switch policy', async () => {
    enableSelfHosted();
    H.assertAllowed.mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'gemini_circuit_open' }));
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(H.chatHandler).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('per-tenant quota rejection on the selfhosted gate → 429 (quota is provider-agnostic)', async () => {
    enableSelfHosted();
    H.assertAllowed.mockRejectedValue(
      Object.assign(new Error('quota'), {
        code: 'gemini_quota_exceeded',
        quota: { reason: 'requests_exceeded', usage: 31, limit: 30 },
      }),
    );
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('requests_exceeded');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('whitelist still rules: a non-whitelisted action is 403 even when routed to selfhosted', async () => {
    enableSelfHosted();
    process.env.AI_PROVIDER_ACTIONS_SELFHOSTED = 'rm_minus_rf';
    const res = await request(buildApp())
      .post('/api/gemini')
      .set(uid)
      .send({ action: 'rm_minus_rf', args: [] });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('empty self-hosted completion + explicit fallback opt-in → Gemini', async () => {
    enableSelfHosted();
    process.env.AI_SELFHOSTED_FALLBACK_GEMINI = '1';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), { status: 200 }),
    );
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-gemini' });
  });
});
