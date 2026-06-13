// Behavioral tests for the client-side DS-594 art. 110 legal-trigger
// dispatcher used by the ergonomics wizard (AddErgonomicsModal).
//
// Pins the wiring fix: the wizard now POSTs to the server-side legal-trigger
// route (which allocates the DIEP folio with the Admin SDK) instead of trying
// — and failing — to build a client folioStore for the server-only counter.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  apiAuthHeaderMock: vi.fn(async () => 'Bearer test-token' as string | null),
  warnMock: vi.fn(),
}));

vi.mock('../../lib/apiAuth', () => ({ apiAuthHeader: () => H.apiAuthHeaderMock() }));

vi.mock('../../utils/logger', () => ({
  logger: { warn: H.warnMock, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const apiAuthHeaderMock = H.apiAuthHeaderMock;
const warnMock = H.warnMock;

import { dispatchLegalTrigger } from './dispatchLegalTrigger';

const base = {
  projectId: 'proj-1',
  assessmentId: 'assess-xyz',
  workerId: 'worker-1',
  type: 'REBA' as const,
  score: 12,
  computedAt: '2026-06-13T00:00:00.000Z',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiAuthHeaderMock.mockResolvedValue('Bearer test-token');
  warnMock.mockClear();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ triggered: true }) }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('dispatchLegalTrigger', () => {
  it('POSTs to the server legal-trigger route with the auth header', async () => {
    await dispatchLegalTrigger(base);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sprint-k/proj-1/ergonomics/legal-trigger');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('sends assessment fields but NOT identity/tenant (server derives them from the token)', async () => {
    await dispatchLegalTrigger(base);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({
      assessmentId: 'assess-xyz',
      workerId: 'worker-1',
      type: 'REBA',
      score: 12,
      computedAt: '2026-06-13T00:00:00.000Z',
    });
    expect(body.tenantId).toBeUndefined();
    expect(body.userId).toBeUndefined();
  });

  it('skips the request entirely when there is no auth header', async () => {
    apiAuthHeaderMock.mockResolvedValueOnce(null);
    await dispatchLegalTrigger(base);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws and logs a warning when the server responds non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(dispatchLegalTrigger(base)).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith('ergonomic_legal_trigger_failed', { status: 500 });
  });

  it('never throws and logs a warning when fetch rejects (offline/network)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(dispatchLegalTrigger(base)).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(
      'ergonomic_legal_trigger_error',
      expect.objectContaining({ error: 'network down' }),
    );
  });
});
