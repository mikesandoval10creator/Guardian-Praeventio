// Real-router supertest for the /api/gemini whitelisted RPC proxy — a security
// chokepoint. The contract: only allowlisted actions dispatch (403 otherwise),
// and the circuit/quota gate runs before any backend call. Bug-hunting on the
// action allowlist + the circuit(503)/quota(429) gates. geminiBackend (which
// also exports the quota fns) is mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  assertAllowed: vi.fn(),
  analyze: vi.fn(),
  record: vi.fn(),
}));

vi.mock('../../services/geminiBackend.js', () => ({
  assertGeminiAllowed: (...a: unknown[]) => H.assertAllowed(...a),
  recordGeminiOutcome: (...a: unknown[]) => H.record(...a),
  estimateGeminiCostUsd: () => 0.001,
  // a whitelisted action used for the happy path:
  analyzeRiskWithAI: (...a: unknown[]) => H.analyze(...a),
  // 'semanticSearch' is whitelisted but declared non-function here, to
  // exercise the route's defensive "not a function → 400" branch. (vitest
  // mocks throw on truly-undefined export access, so we declare it explicitly.)
  semanticSearch: undefined,
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
vi.mock('../../server/middleware/validate.js', () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_n: string, _c: unknown, fn: () => unknown) => fn(),
}));
vi.mock('../../services/observability/index.js', () => ({ getErrorTracker: () => ({ captureException: vi.fn() }) }));
vi.mock('../../utils/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {} }));
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
  H.analyze.mockReset().mockResolvedValue({ risk: 'high', score: 80 });
  H.record.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/gemini — whitelist + gates', () => {
  it('401 without a token', async () => {
    expect((await request(buildApp()).post('/api/gemini').send({ action: 'analyzeRiskWithAI', args: [] })).status).toBe(401);
  });

  it('403 for an action NOT on the allowlist (security chokepoint)', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'rm_minus_rf', args: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not allowed');
    expect(H.assertAllowed).not.toHaveBeenCalled(); // rejected before the gate even runs
  });

  it('200 dispatches a whitelisted action + records the outcome', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'analyzeRiskWithAI', args: [{ projectId: 'p1' }] });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ risk: 'high', score: 80 });
    expect(H.analyze).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(H.record).toHaveBeenCalledWith('u1', 'success', expect.any(Object));
  });

  it('400 for a whitelisted action that has no backend function', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'semanticSearch', args: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not found');
  });

  it('503 when the circuit breaker is open', async () => {
    H.assertAllowed.mockRejectedValue(Object.assign(new Error('open'), { code: 'gemini_circuit_open' }));
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'analyzeRiskWithAI', args: [] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('gemini_circuit_open');
  });

  it('429 when the per-tenant quota is exceeded', async () => {
    H.assertAllowed.mockRejectedValue(
      Object.assign(new Error('quota'), { code: 'gemini_quota_exceeded', quota: { reason: 'requests_exceeded', usage: 31, limit: 30 } }),
    );
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'analyzeRiskWithAI', args: [] });
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('requests_exceeded');
    expect(res.body.limit).toBe(30);
  });

  it('records a failure outcome when the backend action throws', async () => {
    H.analyze.mockRejectedValue(new Error('gemini upstream 500'));
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'analyzeRiskWithAI', args: [] });
    expect(res.status).toBe(500);
    expect(H.record).toHaveBeenCalledWith('u1', 'failure');
  });
});
