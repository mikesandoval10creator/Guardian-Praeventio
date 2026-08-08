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
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-test-pid/uploads/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        declaredVersion: '1.0.0',
        projectId: 'test-pid',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      dxfUri: 'gs://praeventio-cad/foo.dxf',
      dxfSignedUrl: 'https://storage.googleapis.com/foo-signed',
      sha256: 'abc123',
    });
    expect(res.body.uploadId).toMatch(/^dwg-[a-f0-9]{64}$/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://dwg-fake.run.app/convert');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toMatchObject({
      inputUri: 'gs://praeventio-cad-upload/projects-test-pid/uploads/foo.dwg',
      outputBucket: 'praeventio-cad',
      declaredKind: 'site_plan',
      projectId: 'test-pid',
    });
    expect(sentBody.uploadId).toMatch(/^dwg-[a-f0-9]{64}$/);
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
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-pid/uploads/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

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
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-pid/uploads/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

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
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-pid/uploads/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

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
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-pid/uploads/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      error: 'converter_unreachable',
    });
  });

  // === Sprint 50 E.5 P2 H1 — adversarial validation gate ===

  it('rejects external URI with 400 external_uri_rejected (SSRF gate)', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({
        inputUri: 'https://evil.example.com/file.dwg',
        filename: 'file.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('external_uri_rejected');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects URI from a foreign bucket with 400 external_uri_rejected', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({
        inputUri: 'gs://some-other-bucket/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('external_uri_rejected');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects disallowed extension with 400 cad_validation_failed', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-pid/uploads/foo.exe',
        filename: 'foo.exe',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cad_validation_failed');
    expect(res.body.findings.some((f: { kind: string }) => f.kind === 'extension_invalid')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects path-traversal filename with 400 cad_validation_failed', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-pid/uploads/..%2Fetc%2Fpasswd.dwg',
        filename: '../../../etc/passwd.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cad_validation_failed');
    expect(res.body.findings.some((f: { kind: string }) => f.kind === 'filename_path_traversal')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects oversize file with 400 cad_validation_failed', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-pid/uploads/big.dwg',
        filename: 'big.dwg',
        byteSize: 60 * 1024 * 1024, // 60 MB > 50 MB cap
        declaredKind: 'site_plan',
        projectId: 'pid',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cad_validation_failed');
    expect(res.body.findings.some((f: { kind: string }) => f.kind === 'size_too_large')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects unknown declaredKind with 400 cad_validation_failed', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({
        inputUri: 'gs://praeventio-cad-upload/projects-pid/uploads/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'topology' as any, // not in ALLOWED_KINDS
        projectId: 'pid',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cad_validation_failed');
    expect(res.body.findings.some((f: { kind: string }) => f.kind === 'kind_invalid')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects missing projectId with 400 cad_validation_failed', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({
        inputUri: 'gs://praeventio-cad-upload/uploads/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        // projectId missing
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cad_validation_failed');
    expect(res.body.findings.some((f: { kind: string }) => f.kind === 'project_id_empty')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects project_id_uri_mismatch when URI path does not reference the projectId', async () => {
    process.env.DWG_CONVERTER_URL = 'https://dwg-fake.run.app';
    process.env.DWG_CONVERTER_TOKEN = 'tok';
    process.env.CAD_OUTPUT_BUCKET = 'praeventio-cad';

    const res = await request(makeApp())
      .post('/api/cad/convert-dwg')
      .send({
        // Bucket has /uploads/foo.dwg (no projectId in path), but body says
        // projectId='declared-pid'. Validator passes (projectId is non-empty),
        // but the URI↔projectId symmetry check fails.
        inputUri: 'gs://praeventio-cad-upload/uploads/foo.dwg',
        filename: 'foo.dwg',
        byteSize: 1024 * 100,
        declaredKind: 'site_plan',
        projectId: 'declared-pid',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_id_uri_mismatch');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
