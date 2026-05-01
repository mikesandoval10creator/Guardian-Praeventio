// Praeventio Guard — Round 15 (I3 / A6): /api/ask-guardian.
//
// The real handler proxies to Gemini; we only cover the wiring layer
// (verifyAuth + body validation + Gemini-key precondition) since the
// AI call itself is exercised by geminiBackend tests elsewhere.
//
// Round 20 R6 R19 MEDIUM #1: in production the route is now gated by
// `geminiLimiter` (30 req/15min keyed per-uid). Wiring tests below cover
// the limiter contract — see the second `describe` block. The first
// `describe` continues to exercise the unmetered code paths via the
// shared buildTestServer harness.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { buildTestServer, type TestServerHandle } from './test-server.js';

let handle: TestServerHandle;
const ORIGINAL_GEMINI = process.env.GEMINI_API_KEY;

beforeEach(() => {
  handle = buildTestServer();
});
afterEach(() => {
  if (ORIGINAL_GEMINI === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_GEMINI;
});

describe('POST /api/ask-guardian', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await request(handle.app).post('/api/ask-guardian').send({ query: 'x' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when query is missing', async () => {
    process.env.GEMINI_API_KEY = 'fake';
    const res = await request(handle.app)
      .post('/api/ask-guardian')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 500 when GEMINI_API_KEY is not configured', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await request(handle.app)
      .post('/api/ask-guardian')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ query: 'qué dice DS 594?' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/GEMINI_API_KEY/);
  });

  it('happy path: authed call with key set returns response shape', async () => {
    process.env.GEMINI_API_KEY = 'fake';
    const res = await request(handle.app)
      .post('/api/ask-guardian')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ query: 'qué dice DS 594?' });
    expect(res.status).toBe(200);
    expect(typeof res.body.response).toBe('string');
    expect(typeof res.body.contextUsed).toBe('boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Round 20 R6 R19 MEDIUM #1 — per-uid rate limiter on /api/ask-guardian.
//
// Closes the cost-exposure gap where an authed caller could hit the
// expensive RAG+Gemini SSE path under only the global 100/15min /api/*
// cap. We mirror the production wiring: `verifyAuth` runs first so the
// limiter's keyGenerator can read req.user.uid (per-uid bucket); a
// pre-auth 401 (no/invalid Bearer header) is rejected before the limiter
// runs, so unauthenticated floods do NOT consume any uid's quota.
//
// Each test builds its own app so the express-rate-limit in-memory
// counter store is fresh — sharing a singleton would leak counts across
// tests. We tighten `max` to 3 in most tests to keep the suite fast.
// ─────────────────────────────────────────────────────────────────────────

interface AskGuardianRateDeps {
  /** Override max. Defaults to 3 in these tests for speed (production = 30). */
  max?: number;
  /** Override window. Defaults to 60_000 ms (production = 15 * 60 * 1000). */
  windowMs?: number;
  /** Sink for audit-log calls so we can assert emission survives the limiter. */
  auditSink?: Array<{ uid: string; query: string }>;
}

/**
 * Builds an /api/ask-guardian app that mirrors the production middleware
 * chain shape — `verifyAuth → geminiLimiter → handler`. The handler is
 * minimal (no real Gemini call) but emits an audit-log row so we can
 * assert that the limiter does not break observability hooks.
 */
function buildLimitedAskGuardianApp(deps: AskGuardianRateDeps = {}): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split('Bearer ')[1];
    if (token === 'invalid') {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    // Convention: "test:uid:email" → decoded.
    const [, uid, email] = token.split(':');
    (req as any).user = { uid: uid ?? 'uid-default', email: email || `${uid}@test.com` };
    next();
  };

  // Mirror src/server/middleware/limiters.ts → geminiLimiter shape.
  const limiter = rateLimit({
    windowMs: deps.windowMs ?? 15 * 60 * 1000,
    max: deps.max ?? 3,
    keyGenerator: (req: Request) => (req as any).user?.uid || req.ip || 'anonymous',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Límite de consultas IA alcanzado. Intenta de nuevo en 15 minutos.' },
  });

  app.post('/api/ask-guardian', verifyAuth, limiter, async (req: Request, res: Response) => {
    const uid = (req as any).user.uid as string;
    const { query } = req.body ?? {};
    if (typeof query !== 'string' || query.length === 0) {
      return res.status(400).json({ error: 'query is required' });
    }
    deps.auditSink?.push({ uid, query });
    res.json({ response: `Echo: ${query}`, contextUsed: false });
  });

  return app;
}

describe('POST /api/ask-guardian — R20 R6 R19 MEDIUM #1 per-uid rate limiter', () => {
  it('blocks the 4th request from the same uid in the same window with 429', async () => {
    const app = buildLimitedAskGuardianApp({ max: 3 });
    const auth = 'Bearer test:uid-rl:rl@test.com';

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/ask-guardian')
        .set('Authorization', auth)
        .send({ query: `q${i}` });
      expect(res.status).toBe(200);
    }

    const fourth = await request(app)
      .post('/api/ask-guardian')
      .set('Authorization', auth)
      .send({ query: 'q-blocked' });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatch(/Límite de consultas IA/);
  });

  it('keeps per-uid quotas independent — uid A exhausting its budget does not throttle uid B', async () => {
    const app = buildLimitedAskGuardianApp({ max: 2 });
    const authA = 'Bearer test:uid-A:a@test.com';
    const authB = 'Bearer test:uid-B:b@test.com';

    // Burn uid A's full quota (2) + one extra to confirm the cap.
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/api/ask-guardian')
        .set('Authorization', authA)
        .send({ query: `a${i}` });
      expect(res.status).toBe(200);
    }
    const blocked = await request(app)
      .post('/api/ask-guardian')
      .set('Authorization', authA)
      .send({ query: 'a-blocked' });
    expect(blocked.status).toBe(429);

    // uid B starts with a fresh budget — first call still succeeds.
    const resB = await request(app)
      .post('/api/ask-guardian')
      .set('Authorization', authB)
      .send({ query: 'b0' });
    expect(resB.status).toBe(200);
  });

  it('does NOT count pre-auth 401s against any uid bucket', async () => {
    // verifyAuth rejects → middleware chain stops before the limiter, so
    // unauthenticated floods cannot push a real uid past its quota. We
    // hammer the endpoint with a missing Bearer header many times, then
    // confirm the LEGITIMATE caller still has its full budget afterwards.
    const app = buildLimitedAskGuardianApp({ max: 3 });
    for (let i = 0; i < 20; i++) {
      const r = await request(app).post('/api/ask-guardian').send({ query: 'x' });
      expect(r.status).toBe(401);
    }

    const auth = 'Bearer test:uid-clean:c@test.com';
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/ask-guardian')
        .set('Authorization', auth)
        .send({ query: `q${i}` });
      expect(res.status).toBe(200);
    }
  });

  it('429 response shape matches the limiter contract (Spanish-CL message)', async () => {
    const app = buildLimitedAskGuardianApp({ max: 1 });
    const auth = 'Bearer test:uid-shape:s@test.com';

    const ok = await request(app)
      .post('/api/ask-guardian')
      .set('Authorization', auth)
      .send({ query: 'first' });
    expect(ok.status).toBe(200);

    const blocked = await request(app)
      .post('/api/ask-guardian')
      .set('Authorization', auth)
      .send({ query: 'second' });
    expect(blocked.status).toBe(429);
    // Limiter message is the Spanish-CL string from src/server/middleware/limiters.ts
    expect(blocked.body).toEqual({
      error: 'Límite de consultas IA alcanzado. Intenta de nuevo en 15 minutos.',
    });
    // express-rate-limit v7 emits standardHeaders: ratelimit-* on the response.
    expect(blocked.headers['ratelimit-limit']).toBeDefined();
  });

  it('preserves audit-log emission for requests that pass the limiter', async () => {
    const auditSink: Array<{ uid: string; query: string }> = [];
    const app = buildLimitedAskGuardianApp({ max: 3, auditSink });
    const auth = 'Bearer test:uid-audit:au@test.com';

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/api/ask-guardian')
        .set('Authorization', auth)
        .send({ query: `audit-${i}` });
      expect(res.status).toBe(200);
    }
    expect(auditSink).toEqual([
      { uid: 'uid-audit', query: 'audit-0' },
      { uid: 'uid-audit', query: 'audit-1' },
    ]);

    // 4th request should be 429 — and must NOT add an audit row.
    await request(app).post('/api/ask-guardian').set('Authorization', auth).send({ query: 'a' });
    const blocked = await request(app)
      .post('/api/ask-guardian')
      .set('Authorization', auth)
      .send({ query: 'never-audited' });
    expect(blocked.status).toBe(429);
    expect(auditSink.find((row) => row.query === 'never-audited')).toBeUndefined();
  });

  it('does not double-count: a single request consumes exactly one slot from the uid bucket', async () => {
    const app = buildLimitedAskGuardianApp({ max: 5 });
    const auth = 'Bearer test:uid-count:c@test.com';

    // 5 requests should all succeed; 6th must fail. (If the limiter were
    // mounted before verifyAuth or counted twice, the 5th would already
    // be blocked.)
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/ask-guardian')
        .set('Authorization', auth)
        .send({ query: `q${i}` });
      expect(res.status).toBe(200);
    }
    const sixth = await request(app)
      .post('/api/ask-guardian')
      .set('Authorization', auth)
      .send({ query: 'q5' });
    expect(sixth.status).toBe(429);
  });
});
