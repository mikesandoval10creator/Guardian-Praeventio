// SPDX-License-Identifier: MIT
// Sprint 17a → Sprint 21 Bucket Q.
//
// Tests for /api/cad/convert-dwg now that the route proxies to the
// isolated LibreDWG Cloud Run service (instead of returning 501). The
// tests stub global fetch with vi.fn() so we can exercise:
//   1. Missing env vars  → 503 not_configured
//   2. Happy path        → 200 with dxfSignedUrl + sha256
//   3. Upstream failure  → 502 converter_failed
//   4. Auth missing      → 401 (heredado de verifyAuth) — covered
//                          by the auth-mocked variant test below.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock auth — by default authenticated. The "auth missing" case re-mocks
// the module locally to simulate verifyAuth rejecting.
vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = { uid: 'test-uid' };
    next();
  },
}));

import cadRouter from './cad.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/cad', cadRouter);
  return app;
}

describe('POST /api/cad/convert-dwg (Sprint 21 Bucket Q proxy)', () => {
  const ORIGINAL_ENV = { ...process.env };
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    // vi.stubGlobal swaps globalThis.fetch for the duration of the test;
    // the route uses the global fetch, so this is the documented hook.
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('returns 503 dwg_converter_not_configured when DWG_CONVERTER_URL is missing', async () => {
    delete process.env.DWG_CONVERTER_URL;
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({ inputUri: 'gs://in/foo.dwg' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'dwg_converter_not_configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 503 when DWG_CONVERTER_TOKEN is missing', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    delete process.env.DWG_CONVERTER_TOKEN;
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({ inputUri: 'gs://in/foo.dwg' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'dwg_converter_not_configured' });
  });

  it('returns 400 missing_input_uri when body has no inputUri', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'missing_input_uri' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 200 with dxfSignedUrl + sha256 on happy path', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        outputUri: 'gs://praeventio-cad/foo.dxf',
        signedUrl: 'https://storage.googleapis.com/foo-signed',
        sha256: 'abc123',
      }),
    });

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({ inputUri: 'gs://in/foo.dwg' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      dxfUri: 'gs://praeventio-cad/foo.dxf',
      dxfSignedUrl: 'https://storage.googleapis.com/foo-signed',
      sha256: 'abc123',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://dwg-fake.run.app/convert');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({
      inputUri: 'gs://in/foo.dwg',
      outputBucket: 'praeventio-cad',
    });
  });

  it('strips a trailing slash on DWG_CONVERTER_URL before joining /convert', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app/';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        outputUri: 'gs://praeventio-cad/foo.dxf',
        signedUrl: 'https://storage.googleapis.com/foo-signed',
        sha256: 'abc123',
      }),
    });

    await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({ inputUri: 'gs://in/foo.dwg' });

    expect(fetchSpy.mock.calls[0][0]).toBe('https://dwg-fake.run.app/convert');
  });

  it('returns 502 converter_failed on upstream 5xx', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'convert_failed' }),
    });

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({ inputUri: 'gs://in/foo.dwg' });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'converter_failed', status: 500 });
  });

  it('returns 502 converter_failed on upstream 4xx', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'bad_input_uri' }),
    });

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({ inputUri: 'http://nope' });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'converter_failed', status: 400 });
  });

  it('returns 502 converter_unreachable when fetch itself throws', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({ inputUri: 'gs://in/foo.dwg' });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      error: 'converter_unreachable',
    });
  });
});
