import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  assertAllowed: vi.fn(),
  record: vi.fn(),
  backendFn: null as ((...a: unknown[]) => Promise<unknown>) | null,
  fallback: vi.fn(),
}));

vi.mock('../../services/geminiBackend.js', () => {
  const dispatch = (...a: unknown[]) => (H.backendFn ? H.backendFn(...a) : undefined);
  return {
    assertGeminiAllowed: (...a: unknown[]) => H.assertAllowed(...a),
    recordGeminiOutcome: (...a: unknown[]) => H.record(...a),
    estimateGeminiCostUsd: () => 0.001,
    getSafetyAdvice: dispatch,
    getChatResponse: dispatch,
    queryBCN: dispatch,
    analyzeRiskWithAI: dispatch,
  };
});

// Boundary-mock the fallback helper so the supertest is hermetic (no Firestore).
vi.mock('../../services/gemini/geminiSlmFallback.js', () => ({
  hasServerSlmFallback: (action: string) =>
    ['getSafetyAdvice', 'getChatResponse', 'queryBCN'].includes(action),
  geminiSlmFallback: (...a: unknown[]) => H.fallback(...a),
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
  geminiLimiter: (_q: Request, _s: Response, n: NextFunction) => n(),
  geminiGlobalDailyLimiter: (_q: Request, _s: Response, n: NextFunction) => n(),
}));
vi.mock('../../server/middleware/auditLog.js', () => ({ auditServerEvent: vi.fn(async () => true) }));
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
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }),
}));

import geminiRouter from '../../server/routes/gemini.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', geminiRouter);
  return app;
}
const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.assertAllowed.mockReset().mockResolvedValue(undefined);
  H.record.mockReset().mockResolvedValue(undefined);
  H.fallback.mockReset();
  H.backendFn = null;
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.E2E_MODE;
});

describe('/api/gemini — Gemini->SLM/RAG server fallback (directive #2)', () => {
  it('Gemini empty (undefined) -> degraded fallback answer returned (200, degraded:true)', async () => {
    H.backendFn = vi.fn(async () => undefined);
    H.fallback.mockResolvedValue({ text: 'Consejo de respaldo real.', tier: 'canned', confidence: 0.4 });
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'getSafetyAdvice', args: [{ temp: 34, uv: 11 }] });
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.result).toBe('Consejo de respaldo real.');
    expect(res.body.fallbackTier).toBe('canned');
    // Empty upstream completion is recorded as a breaker FAILURE (ADR 0019).
    expect(H.record).toHaveBeenCalledWith('u1', 'failure');
  });

  it('upstream parse/empty error -> fallback used instead of 502 (200, degraded:true)', async () => {
    H.backendFn = vi.fn(async () => { throw new Error('gemini_empty_response'); });
    H.fallback.mockResolvedValue({ text: 'Respuesta RAG verificada.', tier: 'zettelkasten', confidence: 0.9 });
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'queryBCN', args: ['¿DS 594?'] });
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.result).toBe('Respuesta RAG verificada.');
    expect(H.record).toHaveBeenCalledWith('u1', 'failure');
  });

  it('both fail (Gemini empty AND fallback null) -> honest 502', async () => {
    H.backendFn = vi.fn(async () => { throw new SyntaxError('Unexpected token <'); });
    H.fallback.mockResolvedValue(null);
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'getChatResponse', args: ['hola', 'ctx'] });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('gemini_bad_response');
    expect(H.record).toHaveBeenCalledWith('u1', 'failure');
  });

  it('non-wired action returning empty -> NO fallback attempted (unchanged behavior, result:undefined)', async () => {
    H.backendFn = vi.fn(async () => undefined);
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'analyzeRiskWithAI', args: [{}] });
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBeUndefined();
    expect(H.fallback).not.toHaveBeenCalled();
  });

  it('non-empty Gemini success on a wired action -> fallback NOT attempted', async () => {
    H.backendFn = vi.fn(async () => 'Consejo real de Gemini.');
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'getSafetyAdvice', args: [{ temp: 20 }] });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('Consejo real de Gemini.');
    expect(res.body.degraded).toBeUndefined();
    expect(H.fallback).not.toHaveBeenCalled();
    expect(H.record).toHaveBeenCalledWith('u1', 'success', expect.any(Object));
  });
});
