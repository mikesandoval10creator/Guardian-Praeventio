import { describe, it, expect, vi } from 'vitest';
import {
  convertDwgToDxf,
  uploadAndConvertDwg,
  type DwgConversionMetadata,
} from './dwgAdapter';

const METADATA: DwgConversionMetadata = {
  filename: 'planta-electrica.dwg',
  byteSize: 2048,
  projectId: 'p1',
  declaredKind: 'electrical',
  declaredVersion: '1.2.3',
  declaredScale: '1:100',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('convertDwgToDxf', () => {
  it('sends the full validation metadata the server requires', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init });
      if (href.endsWith('/api/cad/convert-dwg')) {
        return jsonResponse({
          ok: true,
          dxfUri: 'gs://out/planta.dxf',
          dxfSignedUrl: 'https://storage.example/planta.dxf',
          sha256: 'abc123',
        });
      }
      return new Response('0\nSECTION\n', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await convertDwgToDxf('gs://in/p1/planta.dwg', METADATA, {
      apiBase: 'https://api.example',
      authToken: 'id-token',
      fetchImpl,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://api.example/api/cad/convert-dwg');
    expect(calls[0]?.init?.method).toBe('POST');
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer id-token',
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      inputUri: 'gs://in/p1/planta.dwg',
      ...METADATA,
    });
    expect(result).toEqual({
      dxfText: '0\nSECTION\n',
      dxfUri: 'gs://out/planta.dxf',
      sha256: 'abc123',
    });
  });

  it('surfaces the server validation error instead of claiming conversion', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'cad_validation_failed' }, 400),
    ) as unknown as typeof fetch;

    await expect(
      convertDwgToDxf('gs://in/p1/planta.dwg', METADATA, { fetchImpl }),
    ).rejects.toThrow('dwg_proxy_failed:400:cad_validation_failed');
  });

  it('rejects a 200 response that is missing the converted artifact fields', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, dxfUri: 'gs://out/planta.dxf' }),
    ) as unknown as typeof fetch;

    await expect(
      convertDwgToDxf('gs://in/p1/planta.dwg', METADATA, { fetchImpl }),
    ).rejects.toThrow('dwg_proxy_missing_fields');
  });
});

describe('uploadAndConvertDwg', () => {
  it('uploads the bytes and forwards the real blob size, not caller metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init });
      if (href === 'https://upload.example/put') {
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/cad/convert-dwg')) {
        return jsonResponse({
          ok: true,
          dxfUri: 'gs://out/planta.dxf',
          dxfSignedUrl: 'https://storage.example/planta.dxf',
          sha256: 'abc123',
        });
      }
      return new Response('DXF', { status: 200 });
    }) as unknown as typeof fetch;

    const file = new Blob([new Uint8Array(4096)], {
      type: 'application/octet-stream',
    });
    const result = await uploadAndConvertDwg(
      file,
      {
        uploadUrl: 'https://upload.example/put',
        inputUri: 'gs://in/p1/planta.dwg',
      },
      // Deliberately wrong: the helper must derive the real byte length.
      { ...METADATA, byteSize: 1 },
      { fetchImpl },
    );

    expect(calls[0]?.url).toBe('https://upload.example/put');
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(calls[0]?.init?.body).toBe(file);
    expect(calls[0]?.init?.headers).toEqual({
      'Content-Type': 'application/octet-stream',
    });

    const proxyBody = JSON.parse(String(calls[1]?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(proxyBody.byteSize).toBe(4096);
    expect(proxyBody.filename).toBe(METADATA.filename);
    expect(proxyBody.projectId).toBe('p1');
    expect(proxyBody.declaredKind).toBe('electrical');
    expect(result.dxfText).toBe('DXF');
  });
});
