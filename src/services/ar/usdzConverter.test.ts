// SPDX-License-Identifier: MIT
// Sprint 23 Bucket EE.8 — UsdzConverter unit tests.
//
// Pure fetch-mocked tests; no network, no GCS, no Docker. The converter
// service itself is exercised by manual smoke tests at deploy time
// (see docs/usdz-converter-deploy.md).

import { describe, it, expect, vi } from 'vitest';

import { UsdzConverter } from './usdzConverter';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('UsdzConverter.fromEnv', () => {
  it('returns null when USDZ_CONVERTER_URL is missing', () => {
    expect(UsdzConverter.fromEnv({ USDZ_CONVERTER_TOKEN: 'tok' })).toBeNull();
  });

  it('returns null when USDZ_CONVERTER_TOKEN is missing', () => {
    expect(UsdzConverter.fromEnv({ USDZ_CONVERTER_URL: 'https://x' })).toBeNull();
  });

  it('returns null when both vars are absent', () => {
    expect(UsdzConverter.fromEnv({})).toBeNull();
  });

  it('returns an instance when both vars are set', () => {
    const inst = UsdzConverter.fromEnv({
      USDZ_CONVERTER_URL: 'https://usdz.example.com',
      USDZ_CONVERTER_TOKEN: 'sekret',
    });
    expect(inst).toBeInstanceOf(UsdzConverter);
  });
});

describe('UsdzConverter.convertGlbToUsdz', () => {
  it('POSTs to /convert with bearer token and json body', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        outputUri: 'gs://b/x.usdz',
        signedUrl: 'https://signed/x',
        sha256: 'a'.repeat(64),
      }),
    );
    const conv = new UsdzConverter('https://api.example.com', 'tok', fetchMock as unknown as typeof fetch);

    await conv.convertGlbToUsdz('gs://in/foo.glb', 'out-bucket');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/convert');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer tok');
    const parsed = JSON.parse(init.body as string) as { inputUri: string; outputBucket: string };
    expect(parsed.inputUri).toBe('gs://in/foo.glb');
    expect(parsed.outputBucket).toBe('out-bucket');
  });

  it('strips trailing slash from baseUrl in fromEnv', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        outputUri: 'gs://b/x.usdz',
        signedUrl: 'https://signed/x',
        sha256: 'a'.repeat(64),
      }),
    );
    const conv = UsdzConverter.fromEnv(
      { USDZ_CONVERTER_URL: 'https://api.example.com/', USDZ_CONVERTER_TOKEN: 'tok' },
      fetchMock as unknown as typeof fetch,
    );
    expect(conv).not.toBeNull();
    await conv!.convertGlbToUsdz('gs://in/x.glb', 'out');
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/convert');
  });

  it('maps a successful response to ok:true with all fields', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        outputUri: 'gs://buck/foo.usdz',
        signedUrl: 'https://signed.example/foo',
        sha256: 'deadbeef',
      }),
    );
    const conv = new UsdzConverter('https://api', 'tok', fetchMock as unknown as typeof fetch);

    const res = await conv.convertGlbToUsdz('gs://in/foo.glb', 'buck');

    expect(res.ok).toBe(true);
    expect(res.outputUri).toBe('gs://buck/foo.usdz');
    expect(res.signedUrl).toBe('https://signed.example/foo');
    expect(res.sha256).toBe('deadbeef');
    expect(res.error).toBeUndefined();
  });

  it('returns ok:false with server error code when status is 4xx', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { ok: false, error: 'unauthorized' }),
    );
    const conv = new UsdzConverter('https://api', 'tok', fetchMock as unknown as typeof fetch);

    const res = await conv.convertGlbToUsdz('gs://in/foo.glb', 'buck');

    expect(res.ok).toBe(false);
    expect(res.error).toBe('unauthorized');
    expect(res.outputUri).toBeUndefined();
  });

  it('surfaces stderr in detail when convert_failed is returned', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(502, {
        ok: false,
        error: 'convert_failed',
        stderr: 'CreateNewARKitUsdzPackage failed for /tmp/in.glb',
      }),
    );
    const conv = new UsdzConverter('https://api', 'tok', fetchMock as unknown as typeof fetch);

    const res = await conv.convertGlbToUsdz('gs://in/foo.glb', 'buck');

    expect(res.ok).toBe(false);
    expect(res.error).toBe('convert_failed');
    expect(res.detail).toContain('CreateNewARKitUsdzPackage');
  });

  it('falls back to http_<status> when body has no error field', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    const conv = new UsdzConverter('https://api', 'tok', fetchMock as unknown as typeof fetch);

    const res = await conv.convertGlbToUsdz('gs://in/foo.glb', 'buck');

    expect(res.ok).toBe(false);
    expect(res.error).toBe('http_500');
  });

  it('returns ok:false missing_fields when 200 body lacks outputUri', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    const conv = new UsdzConverter('https://api', 'tok', fetchMock as unknown as typeof fetch);

    const res = await conv.convertGlbToUsdz('gs://in/foo.glb', 'buck');

    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_fields');
  });

  it('returns ok:false network on fetch rejection', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('failed to fetch');
    });
    const conv = new UsdzConverter('https://api', 'tok', fetchMock as unknown as typeof fetch);

    const res = await conv.convertGlbToUsdz('gs://in/foo.glb', 'buck');

    expect(res.ok).toBe(false);
    expect(res.error).toBe('network');
    expect(res.detail).toContain('failed to fetch');
  });

  it('returns ok:false timeout when the abort signal fires', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      // Simulate a hang that respects the abort signal.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted') as Error & { name: string };
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const conv = new UsdzConverter('https://api', 'tok', fetchMock as unknown as typeof fetch);

    const res = await conv.convertGlbToUsdz('gs://in/foo.glb', 'buck', { timeoutMs: 5 });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('timeout');
  });
});
