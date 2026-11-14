// SPDX-License-Identifier: MIT
// Praeventio Guard — TestSprite TC075 (2026-09-28).
//
// Regression coverage for the API 404 contract. Before this fix, any
// request under /api/* that no router claimed fell through to Express'
// default handler, which answers `text/html` with
// `<pre>Cannot GET /api/...</pre>` (and, in production, the SPA catch-all
// answered `GET /api/*` with the 200 HTML shell). Every API client —
// the app, the test suites, third-party integrations — then tried to
// `JSON.parse` an HTML body, and the framework stack leaked in the
// response.
//
// The contract pinned here (matches the existing 4xx envelope):
//
//   • status 404
//   • `Content-Type: application/json`
//   • body exactly `{ "error": "not_found" }`
//
// The middleware under test is the REAL production module. The mini-app
// below mirrors the production mount order of `server.ts`:
//
//   1. API routers
//   2. `app.use('/api', apiNotFoundJson)`  ← the fix
//   3. `app.get('/{*splat}')`               ← SPA catch-all (prod only)
//
// so the assertions also prove the JSON 404 wins over the SPA fallback
// that used to shadow the whole /api namespace in production.

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { apiNotFoundJson } from './apiNotFound.js';

function buildApp() {
  const app = express();

  // (1) API routers — mounted BEFORE the 404 middleware in server.ts.
  app.get('/api/b2d/v1/suite/status', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // (2) API 404 JSON middleware — mounted after EVERY API router.
  app.use('/api', apiNotFoundJson);

  // (3) SPA catch-all — mirrors server.ts (production only). It matches
  //     ANY path, so without (2) it would answer /api/* with HTML.
  app.get('/{*splat}', (_req, res) => {
    res.status(200).type('text/html').send('<html><body>spa</body></html>');
  });

  return app;
}

describe('apiNotFoundJson (TC075)', () => {
  it('answers 404 JSON for an unknown /api path (GET /api/b2d/metrics)', async () => {
    const res = await request(buildApp()).get('/api/b2d/metrics');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(res.text).not.toContain('Cannot GET');
  });

  it('answers 404 JSON for any other unknown /api path', async () => {
    const res = await request(buildApp()).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('answers 404 JSON for the exact /api path', async () => {
    const res = await request(buildApp()).get('/api');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('answers 404 JSON when the method is wrong on an existing API route', async () => {
    const res = await request(buildApp()).post('/api/b2d/v1/suite/status');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('keeps the query string out of the routing decision', async () => {
    const res = await request(buildApp()).get('/api/b2d/metrics?from=tc075');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('does NOT swallow an existing API route (it still reaches the handler)', async () => {
    const res = await request(buildApp()).get('/api/b2d/v1/suite/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('does NOT change non-API SPA behavior (SPA route still returns HTML)', async () => {
    const res = await request(buildApp()).get('/dashboard');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
  });

  it('passes non-API paths through when mounted globally', async () => {
    // Defensive contract: the middleware only answers inside the /api
    // namespace, so mounting it outside `app.use('/api', …)` can never
    // swallow the SPA or the /billing namespace.
    const app = express();
    app.use(apiNotFoundJson);
    app.get('/api/thing', (_req, res) => res.status(200).json({ ok: true }));

    const res = await request(app).get('/not-api');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
  });

  it.each(['/api-docs', '/apifoo'])(
    'does not classify %s as part of the /api namespace', async (path) => {
      const app = express();
      app.use(apiNotFoundJson);
      app.get(path, (_req, res) => res.status(200).json({ ok: true }));

      const res = await request(app).get(path);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    },
  );
});
