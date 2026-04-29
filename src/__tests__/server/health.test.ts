// Praeventio Guard — Round 15 (I3 / A6): /api/health route HTTP tests.
//
// Sanity probe used by Cloud Run / Marketplace listing health checks.
// Covers the happy path (200 + ok shape) and the structure of the JSON
// response so that a regression in the contract (renamed key, dropped
// timestamp) is caught at PR time.

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './test-server.js';

describe('GET /api/health', () => {
  it('returns 200 with ok status when dependencies are reachable', async () => {
    const { app } = buildTestServer();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.firestore).toBe('ok');
  });

  it('includes a timestamp and version field for observability', async () => {
    const { app } = buildTestServer();
    const res = await request(app).get('/api/health');
    expect(typeof res.body.timestamp).toBe('string');
    // ISO-8601 sanity check
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    expect(typeof res.body.version).toBe('string');
  });

  it('does not require auth (no Bearer token)', async () => {
    // Cloud Run probes hit this without auth — must remain unauthenticated.
    const { app } = buildTestServer();
    const res = await request(app).get('/api/health');
    expect(res.status).not.toBe(401);
  });
});
