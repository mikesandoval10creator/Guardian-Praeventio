// Tests for the equipment-QR API client (Bloque 3.11 wire — 5 endpoints + 1
// pure parser). Vital: this is how a worker's QR scan reaches the pre-use
// checklist + recommendation flow. We assert the path/method/body/auth-header
// contract, the Idempotency-Key header on the two mutators, query-string
// composition (history limit / list-by-site status), and the error
// translation (server message > error string > http_<status>).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import {
  registerEquipmentQr,
  lookupEquipmentByQr,
  parseEquipmentQrPayload,
  submitPreUseChecklist,
  fetchEquipmentPreUseHistory,
  listEquipmentBySite,
} from './useEquipmentQr';

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

describe('useEquipmentQr API client', () => {
  // ── 1. register ──────────────────────────────────────────────────────
  it('registerEquipmentQr → POST register, parsed body, auth + json headers', async () => {
    fetchMock.mockResolvedValue(
      okJson({ equipment: { id: 'eq1' }, qrPayload: 'equipment:eq1' }),
    );
    const input = {
      code: 'EXC-01',
      type: 'excavadora',
      criticality: 'high' as const,
    };
    const out = await registerEquipmentQr('p1', input);
    expect(out.equipment).toEqual({ id: 'eq1' });
    expect(out.qrPayload).toBe('equipment:eq1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/equipment-qr/register');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(input);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
    // No idempotency key was supplied → header absent.
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('registerEquipmentQr → forwards the Idempotency-Key header when provided', async () => {
    fetchMock.mockResolvedValue(
      okJson({ equipment: { id: 'eq1' }, qrPayload: 'equipment:eq1' }),
    );
    await registerEquipmentQr(
      'p1',
      { code: 'EXC-01', type: 'excavadora', criticality: 'low' as const },
      'idem-key-123',
    );
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-key-123');
  });

  // ── 2. lookup ────────────────────────────────────────────────────────
  it('lookupEquipmentByQr → GET equipment-qr/:qrId (url-encoded), parsed equipment + checklist', async () => {
    fetchMock.mockResolvedValue(
      okJson({ equipment: { id: 'eq1' }, checklist: [{ id: 'c1' }] }),
    );
    const out = await lookupEquipmentByQr('p1', 'eq 1/special');
    expect(out.equipment).toEqual({ id: 'eq1' });
    expect(out.checklist).toEqual([{ id: 'c1' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/equipment-qr/eq%201%2Fspecial');
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  // ── 2b. parseEquipmentQrPayload (pure helper) ────────────────────────
  it('parseEquipmentQrPayload extracts the id from an "equipment:" payload', () => {
    expect(parseEquipmentQrPayload('equipment:abc-123')).toBe('abc-123');
    // Case-insensitive prefix + surrounding whitespace are tolerated.
    expect(parseEquipmentQrPayload('  EQUIPMENT: xyz-789  ')).toBe('xyz-789');
  });

  it('parseEquipmentQrPayload accepts a bare uuid-ish id as fallback', () => {
    expect(parseEquipmentQrPayload('abc123-DEF')).toBe('abc123-DEF');
  });

  it('parseEquipmentQrPayload returns null for empty, oversized, or invalid input', () => {
    expect(parseEquipmentQrPayload('')).toBeNull();
    expect(parseEquipmentQrPayload('   ')).toBeNull();
    expect(parseEquipmentQrPayload('equipment:')).toBeNull();
    expect(parseEquipmentQrPayload('https://evil.example/x')).toBeNull();
    expect(parseEquipmentQrPayload('x'.repeat(257))).toBeNull();
    // Too short to pass the bare-id fallback regex (min 6 chars).
    expect(parseEquipmentQrPayload('abc')).toBeNull();
  });

  // ── 3. preuse ────────────────────────────────────────────────────────
  it('submitPreUseChecklist → POST :qrId/preuse, parsed recommendation, auth headers', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        validation: { id: 'v1' },
        recommendation: { action: 'proceed', severity: 'info', message: 'ok' },
        appliedStatus: 'operativo',
        auditHash: 'h1',
      }),
    );
    const input = {
      responses: [{ itemId: 'c1', value: true }] as never,
      signatureHashHex: 'deadbeef',
    };
    const out = await submitPreUseChecklist('p1', 'eq1', input);
    expect(out.recommendation.action).toBe('proceed');
    expect(out.appliedStatus).toBe('operativo');
    expect(out.auditHash).toBe('h1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/equipment-qr/eq1/preuse');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(input);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('submitPreUseChecklist → surfaces a recommend_not_operate recommendation (never blocks)', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        validation: { id: 'v2' },
        recommendation: {
          action: 'recommend_not_operate',
          severity: 'critical',
          message: 'RECOMENDAMOS no operar',
        },
        appliedStatus: 'restringido',
        auditHash: 'h2',
      }),
    );
    const out = await submitPreUseChecklist('p1', 'eq1', {
      responses: [] as never,
    });
    // Founder directive: the validation is still recorded; the recommendation
    // is digital guidance, the call resolves successfully (no throw).
    expect(out.recommendation.action).toBe('recommend_not_operate');
    expect(out.validation).toEqual({ id: 'v2' });
  });

  it('submitPreUseChecklist → forwards the Idempotency-Key header when provided', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        validation: {},
        recommendation: { action: 'proceed', severity: 'info', message: 'ok' },
        appliedStatus: 'operativo',
        auditHash: 'h',
      }),
    );
    await submitPreUseChecklist(
      'p1',
      'eq1',
      { responses: [] as never },
      'preuse-idem-9',
    );
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('preuse-idem-9');
  });

  // ── 4. history ───────────────────────────────────────────────────────
  it('fetchEquipmentPreUseHistory → GET :qrId/history with no query when limit omitted', async () => {
    fetchMock.mockResolvedValue(okJson({ history: [{ id: 'v1' }] }));
    const out = await fetchEquipmentPreUseHistory('p1', 'eq1');
    expect(out.history).toEqual([{ id: 'v1' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/equipment-qr/eq1/history');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('fetchEquipmentPreUseHistory → appends ?limit= when a limit is supplied', async () => {
    fetchMock.mockResolvedValue(okJson({ history: [] }));
    await fetchEquipmentPreUseHistory('p1', 'eq1', { limit: 25 });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/sprint-k/p1/equipment-qr/eq1/history?limit=25',
    );
  });

  // ── 5. list by site ──────────────────────────────────────────────────
  it('listEquipmentBySite → GET list-by-site with no query when status omitted', async () => {
    fetchMock.mockResolvedValue(okJson({ equipment: [{ id: 'eq1' }] }));
    const out = await listEquipmentBySite('p1');
    expect(out.equipment).toEqual([{ id: 'eq1' }]);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/sprint-k/p1/equipment-qr/list-by-site',
    );
  });

  it('listEquipmentBySite → appends ?status= when a status filter is supplied', async () => {
    fetchMock.mockResolvedValue(okJson({ equipment: [] }));
    await listEquipmentBySite('p1', { status: 'operativo' });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/sprint-k/p1/equipment-qr/list-by-site?status=operativo',
    );
  });

  // ── error translation (shared json<T> helper) ────────────────────────
  it('prefers the server-provided message field on a non-ok response', async () => {
    fetchMock.mockResolvedValue(
      errJson(400, { message: 'campo inválido', error: 'bad_request' }),
    );
    await expect(
      registerEquipmentQr('p1', {
        code: 'x',
        type: 't',
        criticality: 'low' as const,
      }),
    ).rejects.toThrow('campo inválido');
  });

  it('falls back to the error field when no message is present', async () => {
    fetchMock.mockResolvedValue(errJson(403, { error: 'forbidden' }));
    await expect(lookupEquipmentByQr('p1', 'eq1')).rejects.toThrow('forbidden');
  });

  it('throws http_<status> when the error body has neither message nor error', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    await expect(
      submitPreUseChecklist('p1', 'eq1', { responses: [] as never }),
    ).rejects.toThrow('http_500');
  });

  it('tolerates an unparseable error body (falls back to http_<status>)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(listEquipmentBySite('p1')).rejects.toThrow('http_502');
  });
});
