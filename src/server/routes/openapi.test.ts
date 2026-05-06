// SPDX-License-Identifier: MIT
// Sprint 36 — Tests for /api/openapi.{json,html} router.
//
// These tests verify the public contract: the spec is reachable without
// auth, returns 200 + the expected content-type, and includes well-known
// keys. They mount the router into a stand-alone Express app so we don't
// need to boot the full server.ts (which initialises Firebase + KMS).

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import openapiRouter from './openapi.js';

function buildApp() {
  const app = express();
  app.use('/api', openapiRouter);
  return app;
}

describe('GET /api/openapi.json', () => {
  it('responds 200 with application/json and a 3.1.0 OpenAPI doc — no auth required', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toMatch(/Praeventio/);
    // Spot check that the B2D climate endpoint shows up — proof the
    // bootstrap ran end-to-end.
    expect(res.body.paths['/api/b2d/v1/climate/current']).toBeTruthy();
  });

  it('GET /api/openapi.html returns Swagger UI HTML, no auth', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/openapi.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/swagger-ui/);
    expect(res.text).toMatch(/\/api\/openapi\.json/);
  });
});
