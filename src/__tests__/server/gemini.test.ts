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

// Sprint 10 — Deliverable A: env-context injection in /api/ask-guardian.
// Replicates the "Portal → Sentidos → Mente" pattern from the legacy
// orchestrator (see docs/proto/analisis_funcional.md). These tests cover
// the four documented behaviors of the new pipeline.
describe('POST /api/ask-guardian — env-context injection (Sprint 10)', () => {
  const ORIG_API_KEY = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('includes env context when projectId + geo are valid', async () => {
    const fs2 = new InMemoryFirestore();
    fs2.store.set('projects/proj-1', { lat: -33.45, lng: -70.66, altitude: 520 });
    const fetchEnv = async (_lat: number, _lng: number) => ({
      weather: { temp: 18, conditions: 'Despejado' },
      seismic: null,
      lastUpdated: 1234567890,
    });
    const h = buildTestServer({
      firestore: fs2,
      fetchEnvironmentContext: fetchEnv,
      envContextEnabled: true,
    });
    const res = await request(h.app)
      .post('/api/ask-guardian')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ query: '¿Riesgos térmicos hoy?', projectId: 'proj-1' });
    expect(res.status).toBe(200);
    expect(res.body.envContextUsed).toBe(true);
    expect(res.body.envContextSnippet).toContain('Despejado');
  });

  it('skips env context when projectId is missing', async () => {
    const fetchEnv = async () => {
      throw new Error('should not be called');
    };
    const h = buildTestServer({
      fetchEnvironmentContext: fetchEnv,
      envContextEnabled: true,
    });
    const res = await request(h.app)
      .post('/api/ask-guardian')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ query: 'pregunta sin proyecto' });
    expect(res.status).toBe(200);
    expect(res.body.envContextUsed).toBe(false);
    expect(res.body.envContextSnippet).toBeNull();
  });

  it('skips env context when fetchEnvironmentContext times out (RAG still works)', async () => {
    const fs2 = new InMemoryFirestore();
    fs2.store.set('projects/proj-2', { lat: -33.45, lng: -70.66 });
    const fetchEnv = (_lat: number, _lng: number) =>
      new Promise<any>((resolve) => setTimeout(() => resolve({ weather: { temp: 1 } }), 200));
    const h = buildTestServer({
      firestore: fs2,
      fetchEnvironmentContext: fetchEnv,
      envContextEnabled: true,
      envContextTimeoutMs: 50,
    });
    const res = await request(h.app)
      .post('/api/ask-guardian')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ query: 'pregunta', projectId: 'proj-2' });
    expect(res.status).toBe(200);
    expect(res.body.envContextUsed).toBe(false);
  });

  it('skips env context when fetchEnvironmentContext throws (RAG still works)', async () => {
    const fs2 = new InMemoryFirestore();
    fs2.store.set('projects/proj-3', { lat: -33.45, lng: -70.66 });
    const fetchEnv = async () => {
      throw new Error('orchestrator boom');
    };
    const h = buildTestServer({
      firestore: fs2,
      fetchEnvironmentContext: fetchEnv,
      envContextEnabled: true,
    });
    const res = await request(h.app)
      .post('/api/ask-guardian')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ query: 'pregunta', projectId: 'proj-3' });
    expect(res.status).toBe(200);
    expect(res.body.envContextUsed).toBe(false);
  });

  it('ENV_CONTEXT_ENABLED=false bypasses entirely (legacy behavior)', async () => {
    const fs2 = new InMemoryFirestore();
    fs2.store.set('projects/proj-4', { lat: -33.45, lng: -70.66 });
    let called = false;
    const fetchEnv = async () => {
      called = true;
      return { weather: { temp: 22 } };
    };
    const h = buildTestServer({
      firestore: fs2,
      fetchEnvironmentContext: fetchEnv,
      envContextEnabled: false,
    });
    const res = await request(h.app)
      .post('/api/ask-guardian')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ query: 'pregunta', projectId: 'proj-4' });
    expect(res.status).toBe(200);
    expect(res.body.envContextUsed).toBe(false);
    expect(called).toBe(false);
  });

  // Restore original env to avoid leaking into other suites.
  if (ORIG_API_KEY === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = ORIG_API_KEY;
  }
});
