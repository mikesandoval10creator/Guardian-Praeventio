// Tests for the externalAuditPortal HTTP client (Wire-orphan Bloque 3 §3.7).
// Two surfaces: ADMIN (Firebase-authed: create/list/revoke/access-log) and
// PUBLIC (token-only, NO Firebase auth header). We assert the path/method/body/
// header contract for each wrapper and the error translation in `unwrap`
// (message > error > code > http_<status>). The public path is asserted
// separately to prove it does NOT attach the Authorization header — a real
// regression risk if it shared the admin fetch wrapper.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import {
  createExternalAuditPortal,
  listExternalAuditPortals,
  revokeExternalAuditPortal,
  getExternalAuditPortalAccessLog,
  fetchPublicAuditPortal,
} from './useExternalAuditPortal';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errJson(status: number, body: unknown = {}): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

const createInput = {
  id: 'portal-1',
  auditorName: 'Inspector X',
  auditorAffiliation: 'suseso',
  auditorEmail: 'x@example.cl',
  scopeProjectIds: ['p1', 'p2'],
  scopeModules: ['iper'],
  ttlDays: 7,
  internalNotes: 'note',
} as never;

describe('externalAuditPortal admin client', () => {
  // ── create ──────────────────────────────────────────────────────────────
  it('createExternalAuditPortal → POST /create with body + auth + json headers', async () => {
    fetchMock.mockResolvedValue(
      okJson({ portal: { id: 'portal-1', oneTimeAccessToken: 'tok-once' } }),
    );
    const out = await createExternalAuditPortal(createInput);
    expect(out.portal).toMatchObject({ id: 'portal-1', oneTimeAccessToken: 'tok-once' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/audit-portal/create');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(createInput);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
    // no idempotency key supplied → header absent
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('createExternalAuditPortal forwards the Idempotency-Key header when provided', async () => {
    fetchMock.mockResolvedValue(okJson({ portal: { id: 'portal-1' } }));
    await createExternalAuditPortal(createInput, { idempotencyKey: 'idem-123' });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['Idempotency-Key']).toBe('idem-123');
  });

  // ── admin list ──────────────────────────────────────────────────────────
  it('listExternalAuditPortals → GET /admin/list (no query) when no filters', async () => {
    fetchMock.mockResolvedValue(okJson({ portals: [{ id: 'portal-1' }] }));
    const out = await listExternalAuditPortals();
    expect(out.portals).toEqual([{ id: 'portal-1' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/audit-portal/admin/list');
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  it('listExternalAuditPortals → appends affiliation + limit query params', async () => {
    fetchMock.mockResolvedValue(okJson({ portals: [] }));
    await listExternalAuditPortals({ affiliation: 'suseso' as never, limit: 10 });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/audit-portal/admin/list?affiliation=suseso&limit=10',
    );
  });

  // ── revoke ──────────────────────────────────────────────────────────────
  it('revokeExternalAuditPortal → POST /{portalId}/revoke with reason body', async () => {
    fetchMock.mockResolvedValue(okJson({ portal: { id: 'portal-1', status: 'revoked' } }));
    const out = await revokeExternalAuditPortal({ portalId: 'portal-1', reason: 'leak' });
    expect(out.portal).toMatchObject({ status: 'revoked' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/audit-portal/portal-1/revoke');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'leak' });
  });

  it('revokeExternalAuditPortal → URL-encodes the portalId path segment', async () => {
    fetchMock.mockResolvedValue(okJson({ portal: { id: 'a/b' } }));
    await revokeExternalAuditPortal({ portalId: 'a/b c', reason: 'r' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/audit-portal/a%2Fb%20c/revoke');
  });

  // ── access log ──────────────────────────────────────────────────────────
  it('getExternalAuditPortalAccessLog → GET /{portalId}/access-log (no query)', async () => {
    fetchMock.mockResolvedValue(okJson({ portalId: 'portal-1', logs: [{ module: 'iper' }] }));
    const out = await getExternalAuditPortalAccessLog('portal-1');
    expect(out.portalId).toBe('portal-1');
    expect(out.logs).toEqual([{ module: 'iper' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/audit-portal/portal-1/access-log');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('getExternalAuditPortalAccessLog → appends the limit query param', async () => {
    fetchMock.mockResolvedValue(okJson({ portalId: 'portal-1', logs: [] }));
    await getExternalAuditPortalAccessLog('portal-1', { limit: 25 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/audit-portal/portal-1/access-log?limit=25');
  });

  // ── error translation (unwrap) ──────────────────────────────────────────
  it('prefers body.message over error/code on a non-ok response', async () => {
    fetchMock.mockResolvedValue(
      errJson(400, { message: 'bad input', error: 'err', code: 'c' }),
    );
    await expect(createExternalAuditPortal(createInput)).rejects.toThrow('bad input');
  });

  it('falls back to body.error then body.code when message is absent', async () => {
    fetchMock.mockResolvedValue(errJson(409, { error: 'conflict' }));
    await expect(revokeExternalAuditPortal({ portalId: 'p', reason: 'r' })).rejects.toThrow(
      'conflict',
    );

    fetchMock.mockResolvedValue(errJson(422, { code: 'invalid_scope' }));
    await expect(listExternalAuditPortals()).rejects.toThrow('invalid_scope');
  });

  it('throws http_<status> when the error body has no message/error/code', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    await expect(getExternalAuditPortalAccessLog('p')).rejects.toThrow('http_500');
  });

  it('tolerates an unparseable error body (falls back to http_<status>)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(listExternalAuditPortals()).rejects.toThrow('http_502');
  });
});

describe('externalAuditPortal public client (token-only, no Firebase auth)', () => {
  it('fetchPublicAuditPortal → GET /public/{token} with module + projectId query, NO auth header', async () => {
    fetchMock.mockResolvedValue(
      okJson({ portal: { portalId: 'portal-1', module: 'iper', projectId: 'p1' } }),
    );
    const out = await fetchPublicAuditPortal({
      token: 'tok-abc',
      module: 'iper' as never,
      projectId: 'p1',
    });
    expect(out.portal).toMatchObject({ portalId: 'portal-1', projectId: 'p1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/audit-portal/public/tok-abc?module=iper&projectId=p1');
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    // The public path is the security-critical assertion: it must NOT attach
    // the Firebase bearer token (it uses bare fetch, not authedFetch).
    expect(headers.Authorization).toBeUndefined();
  });

  it('fetchPublicAuditPortal → appends download=true when requested', async () => {
    fetchMock.mockResolvedValue(okJson({ portal: { portalId: 'portal-1' } }));
    await fetchPublicAuditPortal({
      token: 'tok-abc',
      module: 'iper' as never,
      projectId: 'p1',
      download: true,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/audit-portal/public/tok-abc?module=iper&projectId=p1&download=true',
    );
  });

  it('fetchPublicAuditPortal → URL-encodes the token path segment', async () => {
    fetchMock.mockResolvedValue(okJson({ portal: { portalId: 'portal-1' } }));
    await fetchPublicAuditPortal({
      token: 'a/b c',
      module: 'iper' as never,
      projectId: 'p1',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/audit-portal/public/a%2Fb%20c?module=iper&projectId=p1',
    );
  });

  it('fetchPublicAuditPortal → opaque error surface (403 forbidden)', async () => {
    fetchMock.mockResolvedValue(errJson(403, { error: 'forbidden' }));
    await expect(
      fetchPublicAuditPortal({ token: 'bad', module: 'iper' as never, projectId: 'p1' }),
    ).rejects.toThrow('forbidden');
  });
});
