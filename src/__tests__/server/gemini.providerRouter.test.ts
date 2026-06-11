// Integration test for the AI provider layer THROUGH the real /api/gemini
// dispatch route (the single chokepoint for the whitelisted RPCs).
//
// Exercises the REAL router + REAL providerRouter + REAL selfHostedProvider
// (fetch stubbed at the global boundary — no LLM is called):
//   • no AI_SELFHOSTED_* config → legacy Gemini dispatch, fetch NEVER touched,
//   • routed action + endpoint up → 200 served by the self-hosted provider,
//     Gemini handler NOT called,
//   • routed action + endpoint down → automatic fallback onto the legacy
//     Gemini handler (AI_SELFHOSTED_FALLBACK_GEMINI default ON),
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
}));

import geminiRouter from '../../server/routes/gemini.js';
import { geminiCircuit } from '../../server/middleware/geminiCircuit.js';
import { __resetProviderStatsForTests, SELFHOSTED_CIRCUIT_KEY } from '../../services/ai/providerRouter.js';

function buildApp() {
  const app = express();
  app.use(express.json());
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

  fetchMock.mockReset().mockResolvedValue(
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

  it('endpoint DOWN → automatic fallback onto the legacy Gemini handler (default chain)', async () => {
    enableSelfHosted();
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

  it('open SELF-HOSTED breaker → skips the endpoint and serves via Gemini (chain, not 503)', async () => {
    enableSelfHosted();
    for (let i = 0; i < geminiCircuit.THRESHOLD; i++) {
      geminiCircuit.recordFailure(SELFHOSTED_CIRCUIT_KEY);
    }
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-gemini' });
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

  it('empty self-hosted completion → upstream miss → falls back to the Gemini handler', async () => {
    enableSelfHosted();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), { status: 200 }),
    );
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'respuesta-gemini' });
  });
});
