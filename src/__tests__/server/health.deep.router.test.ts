// Real-router supertest for the PROTECTED /api/health/deep endpoint
// (src/server/routes/health.ts). The deep fan-out (Firestore + KMS + Gemini +
// Resend + Open-Meteo) used to be public + unlimited — a cost/quota drain and an
// internal-state probe. It now requires the shared ops token (HEALTH_DEEP_TOKEN).
// These tests assert the guard rejects before the fan-out ever runs; the minimal
// GET /api/health stays public (covered in health.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  // Never reached on the reject paths; only needed so `import admin` resolves.
  return adminMock(() => ({}) as never);
});

import healthRouter from '../../server/routes/health.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', healthRouter);
  return app;
}

beforeEach(() => {
  process.env.HEALTH_DEEP_TOKEN = 'ops-secret-value';
});
afterEach(() => {
  delete process.env.HEALTH_DEEP_TOKEN;
});

describe('GET /api/health/deep (ops-token, rate-limited)', () => {
  it('401 without the ops bearer token — the dependency fan-out never runs', async () => {
    const res = await request(buildApp()).get('/api/health/deep');
    expect(res.status).toBe(401);
  });

  it('401 with a wrong ops token', async () => {
    const res = await request(buildApp())
      .get('/api/health/deep')
      .set('authorization', 'Bearer not-the-secret');
    expect(res.status).toBe(401);
  });

  it('503 (fail closed) when no ops secret is configured', async () => {
    delete process.env.HEALTH_DEEP_TOKEN;
    const res = await request(buildApp()).get('/api/health/deep');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('deep_health_disabled');
  });
});
