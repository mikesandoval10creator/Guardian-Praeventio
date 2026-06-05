// Real-router supertest for the /api/gemini whitelisted RPC proxy — a security
// chokepoint. The contract: only allowlisted actions dispatch (403 otherwise),
// and the circuit/quota gate runs before any backend call. Bug-hunting on the
// action allowlist + the circuit(503)/quota(429) gates. geminiBackend (which
// also exports the quota fns) is mocked.
//
// Block 2 (2026-05-31): augmented with /api/ask-guardian, /api/gemini/stream,
// JSON.parse fallback (CLAUDE.md #5), prod error-body sanitisation, whitelist
// multi-action sweep, and null/undefined result edge cases. No real LLM called.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ─── hoisted mock state ───────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  assertAllowed: vi.fn(),
  analyze: vi.fn(),
  record: vi.fn(),
  // swappable generic backend fn — reassigned per-test for /api/gemini scenarios
  backendFn: null as ((...args: unknown[]) => Promise<unknown>) | null,
  // mock GoogleGenAI instance — swappable for error tests
  genAiGenerateContent: vi.fn(),
  genAiStream: vi.fn(),
}));

// ─── geminiBackend ────────────────────────────────────────────────────────────
vi.mock('../../services/geminiBackend.js', () => {
  const dispatchHandler = (...args: unknown[]) => {
    if (H.backendFn) return H.backendFn(...args);
    return H.analyze(...args);
  };
  return {
    assertGeminiAllowed: (...a: unknown[]) => H.assertAllowed(...a),
    recordGeminiOutcome: (...a: unknown[]) => H.record(...a),
    estimateGeminiCostUsd: () => 0.001,
    // whitelisted action used for happy-path dispatch tests
    analyzeRiskWithAI: dispatchHandler,
    getSafetyAdvice: dispatchHandler,
    generateEmergencyPlan: dispatchHandler,
    generateSafetyReport: dispatchHandler,
    predictGlobalIncidents: dispatchHandler,
    auditLegalGap: dispatchHandler,
    calculatePreventionROI: dispatchHandler,
    // F3 identity-stamped actions — the dispatcher overwrites their authorUid
    // arg with the verified token uid before calling these.
    syncNodeToNetwork: dispatchHandler,
    syncBatchToNetwork: dispatchHandler,
    // 'semanticSearch' declared as non-function to cover the route's
    // defensive "whitelisted but no backend function → 400" branch.
    semanticSearch: undefined,
  };
});

// ─── verifyAuth ───────────────────────────────────────────────────────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      tier: req.header('x-test-tier') ?? 'bronze',
    };
    next();
  },
}));

// ─── limiters — pass-through ──────────────────────────────────────────────────
vi.mock('../../server/middleware/limiters.js', () => ({
  geminiLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  geminiGlobalDailyLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// auditServerEvent → no-op (B14 adds an audit on the node-sync success path;
// keep it off firebase-admin in this router test).
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => true),
}));

// ─── validate — pass-through (stream endpoint uses real Zod schema) ───────────
// NOTE: we do NOT mock validate so the /api/gemini/stream Zod body validation
// is exercised for real. validate.ts has no heavy deps.

// ─── observability ────────────────────────────────────────────────────────────
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_n: string, _c: unknown, fn: () => unknown) => fn(),
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ─── GoogleGenAI (used by /ask-guardian + /gemini/stream) ────────────────────
// Must be a class (constructor) because the route calls `new GoogleGenAI(...)`.
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: (...a: unknown[]) => H.genAiGenerateContent(...a),
      generateContentStream: (...a: unknown[]) => H.genAiStream(...a),
    };
  },
}));

// ─── Firestore (used by /ask-guardian env-context lookup) ─────────────────────
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
  }),
}));

// ─── ragService (used by /ask-guardian) ──────────────────────────────────────
vi.mock('../../services/ragService.js', () => ({
  searchRelevantContext: vi.fn(async () => 'No se encontró contexto legal relevante.'),
}));

// ─── orchestratorService (ask-guardian env-context) ───────────────────────────
vi.mock('../../services/orchestratorService.js', () => ({
  fetchEnvironmentContext: vi.fn(async () => null),
}));

import geminiRouter from '../../server/routes/gemini.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Matches server.ts: `app.use('/api', geminiRouter)`
  app.use('/api', geminiRouter);
  return app;
}
const uid = { 'x-test-uid': 'u1' };

// Preserve the original NODE_ENV so we can restore it after prod-mode tests.
const ORIG_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  H.assertAllowed.mockReset().mockResolvedValue(undefined);
  H.analyze.mockReset().mockResolvedValue({ risk: 'high', score: 80 });
  H.record.mockReset().mockResolvedValue(undefined);
  H.backendFn = null;
  H.genAiGenerateContent.mockReset().mockResolvedValue({
    text: 'Respuesta de prueba desde el guardián.',
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
  });
  H.genAiStream.mockReset().mockResolvedValue(
    (async function* () { yield { text: 'chunk1' }; })(),
  );
  process.env.GEMINI_API_KEY = 'test-key-fake';
  process.env.NODE_ENV = ORIG_NODE_ENV ?? 'test';
  delete process.env.E2E_MODE;
});

afterEach(() => {
  process.env.NODE_ENV = ORIG_NODE_ENV ?? 'test';
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/gemini — whitelist + gates
// ─────────────────────────────────────────────────────────────────────────────

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

  // ─── F3 — identity-from-token (anti-spoof) ───────────────────────────────────
  // syncNodeToNetwork / syncBatchToNetwork persist the caller's uid (node
  // authorship) via the Admin SDK. The dispatcher MUST overwrite the
  // client-supplied authorUid (arg[1]) with the verified token uid.
  it('F3 — stamps the verified uid over a client-spoofed authorUid (syncNodeToNetwork)', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'syncNodeToNetwork', args: [{ title: 'x' }, 'SPOOFED-UID'] });
    expect(res.status).toBe(200);
    // The backend received the TOKEN uid (u1), not the client-supplied value.
    expect(H.analyze).toHaveBeenCalledWith({ title: 'x' }, 'u1');
  });

  it('F3 — stamps authorUid even when the client omits the identity slot', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'syncNodeToNetwork', args: [{ title: 'x' }] });
    expect(res.status).toBe(200);
    expect(H.analyze).toHaveBeenCalledWith({ title: 'x' }, 'u1');
  });

  it('F3 — stamps authorUid for the batch action too (syncBatchToNetwork)', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'syncBatchToNetwork', args: [[{ title: 'a' }], 'SPOOFED-UID'] });
    expect(res.status).toBe(200);
    expect(H.analyze).toHaveBeenCalledWith([{ title: 'a' }], 'u1');
  });

  it('F3 — rejects an identity-stamped action when args is not an array (400)', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'syncNodeToNetwork', args: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('rejects any action whose args are not an array (400, defense-in-depth)', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'analyzeRiskWithAI', args: { not: 'an array' } });
    expect(res.status).toBe(400);
  });

  it('413 when the serialized args exceed the payload cap', async () => {
    const huge = 'x'.repeat(300_000); // > 256 KB once serialized
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'analyzeRiskWithAI', args: [huge] });
    expect(res.status).toBe(413);
  });

  it('B14 — maps a ProjectMembershipError from the backend to 403 (not 500)', async () => {
    H.backendFn = vi.fn(async () => {
      const err = new Error('Caller is not a member of project pX');
      (err as Error & { name: string }).name = 'ProjectMembershipError';
      throw err;
    });
    const res = await request(buildApp()).post('/api/gemini').set(uid)
      .send({ action: 'syncNodeToNetwork', args: [{ projectId: 'pX' }, 'spoof'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_project');
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

  // ── additional whitelist enforcement tests (Block 2) ───────────────────────

  it('403 for empty-string action (edge — not in whitelist)', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: '', args: [] });
    expect(res.status).toBe(403);
  });

  it('403 for __proto__ action (prototype-pollution probe — not in whitelist)', async () => {
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: '__proto__', args: [] });
    expect(res.status).toBe(403);
  });

  it('whitelist sweep — a broad set of canonical actions are accepted (not 403)', async () => {
    // Spot-check a cross-section of actions from ALLOWED_GEMINI_ACTIONS.
    const actions = [
      'generateEmergencyPlan',
      'predictGlobalIncidents',
      'auditLegalGap',
      'calculatePreventionROI',
      'getSafetyAdvice',
    ];
    for (const action of actions) {
      H.backendFn = vi.fn(async () => ({ ok: true }));
      const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action, args: [] });
      expect(res.status).toBe(200);
    }
  });

  it('5xx in prod hides internal error message (CLAUDE.md #8)', async () => {
    H.analyze.mockRejectedValue(new Error('DB connection lost – PRIVATE'));
    process.env.NODE_ENV = 'production';
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'analyzeRiskWithAI', args: [] });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE');
  });

  it('5xx in non-prod exposes the error message for debugging', async () => {
    H.analyze.mockRejectedValue(new Error('downstream exploded'));
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'analyzeRiskWithAI', args: [] });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('downstream exploded');
  });

  // ── JSON.parse fallback contract (CLAUDE.md #5 + F2) ───────────────────────
  // The route wraps every backend call in try/catch; a SyntaxError from an
  // unguarded JSON.parse inside a service MUST be caught (server must NOT crash)
  // and surfaced as 502 — an unparseable/empty UPSTREAM Gemini body is a bad
  // gateway, not an internal bug. CLAUDE.md #5 already mandates "502".

  it('SyntaxError from backend → 502 gemini_bad_response (caught, not a crash) (CLAUDE.md #5 / F2)', async () => {
    H.analyze.mockRejectedValue(new SyntaxError('Unexpected token < in JSON at position 0'));
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'analyzeRiskWithAI', args: [] });
    // Caught (no crash) AND 502 (bad gateway), not 500: the AI returned garbage,
    // our server is fine.
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('gemini_bad_response');
    // failure outcome is still recorded
    expect(H.record).toHaveBeenCalledWith('u1', 'failure');
  });

  it('gemini_empty_response from backend (parseGeminiJson empty guard) → 502 (F2)', async () => {
    H.analyze.mockRejectedValue(new Error('gemini_empty_response'));
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'analyzeRiskWithAI', args: [] });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('gemini_bad_response');
    expect(H.record).toHaveBeenCalledWith('u1', 'failure');
  });

  it('200 when backend returns null (typed fallback — null is valid, not an error)', async () => {
    H.backendFn = vi.fn(async () => null);
    const res = await request(buildApp()).post('/api/gemini').set(uid).send({ action: 'getSafetyAdvice', args: [] });
    expect(res.status).toBe(200);
    // res.json({ result: null }) — not a crash
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ask-guardian (Block 2)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/ask-guardian', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/ask-guardian').send({ query: '¿Riesgo?' });
    expect(res.status).toBe(401);
  });

  it('500 when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await request(buildApp()).post('/api/ask-guardian').set(uid).send({ query: 'test' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/GEMINI_API_KEY/i);
  });

  it('503 gemini_circuit_open when assertGeminiAllowed throws circuit-open', async () => {
    H.assertAllowed.mockRejectedValue(Object.assign(new Error('open'), { code: 'gemini_circuit_open' }));
    const res = await request(buildApp()).post('/api/ask-guardian').set(uid).send({ query: 'riesgo' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('gemini_circuit_open');
  });

  it('429 quota_exceeded when assertGeminiAllowed throws quota error', async () => {
    H.assertAllowed.mockRejectedValue(
      Object.assign(new Error('quota'), { code: 'gemini_quota_exceeded', quota: { reason: 'requests_exceeded', usage: 50, limit: 50 } }),
    );
    const res = await request(buildApp()).post('/api/ask-guardian').set(uid).send({ query: 'riesgo' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('quota_exceeded');
  });

  it('200 non-stream — returns response + contextUsed flags', async () => {
    const res = await request(buildApp())
      .post('/api/ask-guardian')
      .set(uid)
      .send({ query: '¿Cómo prevenir caída de altura?', stream: false });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.response).toBe('string');
    expect(typeof body.contextUsed).toBe('boolean');
    expect(typeof body.envContextUsed).toBe('boolean');
  });

  it('200 non-stream — recordGeminiOutcome called with success', async () => {
    await request(buildApp()).post('/api/ask-guardian').set({ 'x-test-uid': 'uid-guardian' }).send({ query: 'normativas' });
    expect(H.record).toHaveBeenCalledWith(
      'uid-guardian',
      'success',
      expect.objectContaining({ tokens: expect.any(Number), costUsd: expect.any(Number) }),
    );
  });

  it('500 and failure outcome when GoogleGenAI.generateContent throws', async () => {
    H.genAiGenerateContent.mockRejectedValue(new Error('GenAI exploded'));
    const res = await request(buildApp()).post('/api/ask-guardian').set({ 'x-test-uid': 'uid-err' }).send({ query: 'test' });
    expect(res.status).toBe(500);
    expect(H.record).toHaveBeenCalledWith('uid-err', 'failure');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/gemini/stream (Block 2)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/gemini/stream', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post('/api/gemini/stream').send({ prompt: 'Hello' });
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when prompt is missing (Zod gate)', async () => {
    const res = await request(buildApp()).post('/api/gemini/stream').set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when prompt is empty string (Zod min(1))', async () => {
    const res = await request(buildApp()).post('/api/gemini/stream').set(uid).send({ prompt: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('500 when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await request(buildApp()).post('/api/gemini/stream').set(uid).send({ prompt: 'What are the risks?' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/GEMINI_API_KEY/i);
  });

  it('503 gemini_circuit_open for /gemini/stream', async () => {
    H.assertAllowed.mockRejectedValue(Object.assign(new Error('open'), { code: 'gemini_circuit_open' }));
    const res = await request(buildApp()).post('/api/gemini/stream').set(uid).send({ prompt: 'test prompt' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('gemini_circuit_open');
  });

  it('429 quota_exceeded for /gemini/stream', async () => {
    H.assertAllowed.mockRejectedValue(
      Object.assign(new Error('quota'), { code: 'gemini_quota_exceeded', quota: { reason: 'requests_exceeded', usage: 31, limit: 30 } }),
    );
    const res = await request(buildApp()).post('/api/gemini/stream').set(uid).send({ prompt: 'test prompt' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('quota_exceeded');
  });

  it('200 SSE stream — Content-Type is text/event-stream', async () => {
    const res = await request(buildApp())
      .post('/api/gemini/stream')
      .set(uid)
      .send({ prompt: 'List emergency procedures', sessionId: 'sess-abc' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('200 SSE stream — emits done:false chunk then done:true sentinel', async () => {
    const res = await request(buildApp())
      .post('/api/gemini/stream')
      .set(uid)
      .send({ prompt: 'List emergency procedures' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"done":false');
    expect(res.text).toContain('"done":true');
    expect(res.text).toContain('"totalTokens"');
  });

  it('SSE stream — recordGeminiOutcome called with success', async () => {
    await request(buildApp())
      .post('/api/gemini/stream')
      .set({ 'x-test-uid': 'uid-stream' })
      .send({ prompt: 'emergency plan' });
    expect(H.record).toHaveBeenCalledWith(
      'uid-stream',
      'success',
      expect.objectContaining({ tokens: expect.any(Number), costUsd: expect.any(Number) }),
    );
  });
});
