// Praeventio Guard — security depth: /api/gemini allowlist gate.
//
// The allowlist on /api/gemini IS the security boundary that prevents
// arbitrary backend method invocation. This file asserts that:
//   • A non-allowlisted action (e.g. a "jailbreak" suffix variant) is
//     rejected with 4xx and never dispatches.
//   • Existing allowlist values pass the gate.

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

beforeEach(() => {
  fs = new InMemoryFirestore();
  handle = buildTestServer({ firestore: fs });
});

describe('POST /api/gemini — allowlist gate', () => {
  it('rejects a non-allowlisted action (jailbreak-style suffix) with 400', async () => {
    const res = await request(handle.app)
      .post('/api/gemini')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ action: 'gemini-1.5-pro-experimental-jailbreak', args: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed|Forbidden/i);
  });

  it('rejects a totally unknown action with 400', async () => {
    const res = await request(handle.app)
      .post('/api/gemini')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ action: '__proto__', args: [] });
    expect(res.status).toBe(400);
  });

  it('allows known allowlist entries', async () => {
    for (const action of ['analyzeRiskWithAI', 'generateSafetyReport', 'searchRelevantContext']) {
      const res = await request(handle.app)
        .post('/api/gemini')
        .set('Authorization', 'Bearer test:uid-A:a@test.com')
        .send({ action, args: [] });
      expect(res.status).toBe(200);
      expect(res.body.result).toMatchObject({ ok: true, action });
    }
  });

  it('still requires authentication', async () => {
    const res = await request(handle.app)
      .post('/api/gemini')
      .send({ action: 'analyzeRiskWithAI', args: [] });
    expect(res.status).toBe(401);
  });
});
