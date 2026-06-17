// OLA 1 (VIDA, 2026-06-14) — sendSos transport (the new logic wiring the SOS
// outbox to POST /api/emergency/sos). Pins the server-shaped body + auth, the
// retain/retry signals (non-2xx, network throw), and the fail-fast on a missing
// projectId (the server 400s without it, so it must dead-letter not spin).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => 'Bearer test-token') }));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { sendSos } from './sosOutboxClient';
import type { SosEvent } from './sosOutbox';

const fetchMock = vi.fn();

const ev = (over: Partial<SosEvent> = {}): SosEvent => ({
  clientEventId: 'c1',
  workerUid: 'w1',
  reason: 'manual_button',
  projectId: 'p1',
  coords: { lat: -33.45, lng: -70.66 },
  occurredAt: '2026-06-14T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('sendSos transport', () => {
  it('POSTs /api/emergency/sos with the server-shaped body + Bearer auth, ok on 2xx', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const r = await sendSos(ev());
    expect(r).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/emergency/sos');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'sos',
      uid: 'w1',
      projectId: 'p1',
      geo: { lat: -33.45, lng: -70.66 },
      timestamp: '2026-06-14T00:00:00.000Z',
    });
  });

  it('returns {ok:false, HTTP <status>} on a non-2xx response (engine will retry)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await sendSos(ev())).toEqual({ ok: false, error: 'HTTP 503' });
  });

  it('treats any 2xx as transport-OK (zero-reach is handled at the UI, not by re-POSTing — avoids duplicate alert docs)', async () => {
    // Even a recorded-but-zero-reach response (delivered:false) is a successful
    // TRANSPORT: the SOS is on the server. Re-POSTing would duplicate the
    // emergency_alerts doc, so the outbox stops on the first 2xx.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ delivered: false }) });
    expect(await sendSos(ev())).toEqual({ ok: true });
  });

  it('fails fast (non-retryable) when projectId is missing — the server 400s without it', async () => {
    const r = await sendSos(ev({ projectId: undefined }));
    expect(r).toEqual({ ok: false, error: 'missing_projectId' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns {ok:false} (retryable) on a network throw (offline)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const r = await sendSos(ev());
    expect(r.ok).toBe(false);
  });

  it('sends geo:null when the event has no coords', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    await sendSos(ev({ coords: undefined }));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).geo).toBeNull();
  });
});
