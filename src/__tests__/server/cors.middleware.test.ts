/**
 * RED test for CORS middleware (Bug 2, Bundle-Verify-2026-08-27).
 *
 * Per Daniel 2026-08-27: frontend y API en mismo host (`app.praeventio.net`).
 * Pero la whitelist explícita + Vary: Origin es defensa en profundidad
 * si en el futuro se separa el frontend o se sirve desde Squarespace.
 *
 * What this asserts:
 *  1. Whitelisted origin → ACOO echoes the origin + Vary: Origin.
 *  2. Non-whitelisted origin → ACOO is missing (browser blocks).
 *  3. Preflight (OPTIONS) from whitelisted origin → ACOO + ACAM + ACAC + Vary.
 *  4. Preflight from non-whitelisted origin → no ACOO.
 *  5. Wildcard `*` is NOT used when credentials are enabled (browser blocks it).
 *
 * Test must FAIL on the current code (no ACOO header anywhere).
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { applyCors, CORS_ALLOWED_ORIGINS } from '../../server/middleware/cors';

function buildApp() {
  const app = express();
  applyCors(app);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/echo', express.json(), (req, res) => res.json({ body: req.body }));
  return app;
}

describe('CORS middleware — Bug 2 whitelist (RED)', () => {
  it('whitelisted origin echoes back + sets Vary: Origin', async () => {
    const res = await request(buildApp())
      .get('/api/health')
      .set('Origin', 'https://app.praeventio.net');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.praeventio.net');
    expect(res.headers['vary']).toContain('Origin');
  });

  it('non-whitelisted origin gets NO ACOO header', async () => {
    const res = await request(buildApp())
      .get('/api/health')
      .set('Origin', 'https://evil-site.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight from whitelisted origin succeeds with full allow headers', async () => {
    const res = await request(buildApp())
      .options('/api/echo')
      .set('Origin', 'https://app.praeventio.net')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.praeventio.net');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    // supertest lowercases header keys; values preserve case
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
    expect(res.headers['vary']).toContain('Origin');
  });

  it('preflight from non-whitelisted origin fails (no ACOO)', async () => {
    const res = await request(buildApp())
      .options('/api/echo')
      .set('Origin', 'https://evil-site.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allowlist contains expected prod origins', () => {
    expect(CORS_ALLOWED_ORIGINS).toContain('https://app.praeventio.net');
    expect(CORS_ALLOWED_ORIGINS).toContain('http://localhost:57335'); // dev
  });

  it('does NOT use wildcard "*" (incompatible with credentials)', () => {
    expect(CORS_ALLOWED_ORIGINS).not.toContain('*');
  });
});
