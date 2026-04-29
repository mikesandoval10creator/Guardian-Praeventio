// Praeventio Guard — Round 15 (I3 / A6): /api/ask-guardian.
//
// The real handler proxies to Gemini; we only cover the wiring layer
// (verifyAuth + body validation + Gemini-key precondition) since the
// AI call itself is exercised by geminiBackend tests elsewhere.
//
// In production the route is gated by `geminiLimiter` (30 req/15min);
// the limiter behavior is integration-tested at the express-rate-limit
// level — out of scope here.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
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
