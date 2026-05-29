// Tests for the evacuation-headcount API client (4 mutators). Vital: this is
// how meeting-point QR scans + drill lifecycle reach the server during a real
// evacuation. We assert the path/method/auth-header contract and the error
// translation (server error string vs http_<status>).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import {
  computeEvacuationStatus,
  recordEvacuationScan,
  endEvacuationDrill,
  buildEvacuationPostmortem,
} from './useEvacuation';

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

const drill = { id: 'd1', projectId: 'p1' } as never;

describe('useEvacuation API client', () => {
  it('computeEvacuationStatus → POST compute-status, parsed status, auth + json headers', async () => {
    fetchMock.mockResolvedValue(okJson({ status: { allClear: true, missing: [] } }));
    const out = await computeEvacuationStatus('p1', { drill });
    expect(out.status).toEqual({ allClear: true, missing: [] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/evacuation/compute-status');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ drill });
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('recordEvacuationScan → POST record-scan', async () => {
    fetchMock.mockResolvedValue(okJson({ drill: { id: 'd1' } }));
    const out = await recordEvacuationScan('p1', {
      drill,
      scan: { workerUid: 'w1', meetingPointId: 'm1' },
    });
    expect(out.drill).toEqual({ id: 'd1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sprint-k/p1/evacuation/record-scan');
  });

  it('endEvacuationDrill → POST end-drill', async () => {
    fetchMock.mockResolvedValue(okJson({ drill: { id: 'd1', endedAt: 'now' } }));
    const out = await endEvacuationDrill('p1', { drill });
    expect(out.drill).toMatchObject({ endedAt: 'now' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sprint-k/p1/evacuation/end-drill');
  });

  it('buildEvacuationPostmortem → POST build-postmortem', async () => {
    fetchMock.mockResolvedValue(okJson({ postmortem: { summary: 'ok', evacTimeSec: 120 } }));
    const out = await buildEvacuationPostmortem('p1', { drill });
    expect(out.postmortem).toMatchObject({ evacTimeSec: 120 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sprint-k/p1/evacuation/build-postmortem');
  });

  it('throws the server-provided error string on a non-ok response', async () => {
    fetchMock.mockResolvedValue(errJson(403, { error: 'forbidden' }));
    await expect(computeEvacuationStatus('p1', { drill })).rejects.toThrow('forbidden');
  });

  it('throws http_<status> when the error body has no error field', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    await expect(endEvacuationDrill('p1', { drill })).rejects.toThrow('http_500');
  });

  it('tolerates an unparseable error body (falls back to http_<status>)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(buildEvacuationPostmortem('p1', { drill })).rejects.toThrow('http_502');
  });
});
