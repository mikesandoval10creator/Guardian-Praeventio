// Tests for the legal-obligations calendar API client (Bloque 3.14 wire
// huérfanos). This is the client surface for the DS44/Ley16744/ISO45001
// compliance calendar: upcoming/overdue queries plus the acknowledge/snooze
// mutators that move `nextDueAt` and write the tamper-proof audit chain. We
// assert the path/method/body/auth-header contract, the conditional
// Idempotency-Key header, the default query params (days=30 / limit=100), and
// the error translation (server message/error string vs http_<status>),
// mirroring the proven `useEvacuation.test.ts` shape.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import {
  fetchUpcomingObligations,
  fetchOverdueObligations,
  acknowledgeObligation,
  snoozeObligation,
  fetchObligationHistory,
  useLegalObligations,
} from './useLegalObligations';

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

const obligation = {
  id: 'ob1',
  projectId: 'p1',
  kind: 'DS44',
  nextDueAt: '2026-06-30T00:00:00.000Z',
} as never;

// CalendarEntry-shaped row as returned by the server (`computeCalendar`):
// the obligation plus the derived urgency fields.
const entry = {
  id: 'ob1',
  kind: 'audit',
  label: 'Auditoría ISO 45001 anual',
  legalCitation: 'ISO 45001 cláusula 9.2',
  recurrence: 'annual',
  alertLeadDays: 60,
  nextDueAt: '2026-06-30T00:00:00.000Z',
  daysUntilDue: 10,
  isInAlertWindow: true,
  isOverdue: false,
} as never;

const summary = {
  totalObligations: 1,
  overdue: 0,
  inAlertWindow: 1,
  byKind: { audit: 1 } as Record<string, number>,
};

describe('useLegalObligations API client', () => {
  // ── fetchUpcomingObligations ──────────────────────────────────────────

  it('fetchUpcomingObligations → GET upcoming with default days=30, parsed + auth/json headers', async () => {
    fetchMock.mockResolvedValue(
      okJson({ entries: [entry], summary, windowDays: 30 }),
    );
    const out = await fetchUpcomingObligations('p1');
    expect(out).toEqual({ entries: [entry], summary, windowDays: 30 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/legal-calendar/upcoming?days=30');
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('fetchUpcomingObligations → honors a custom windowDays in the query string', async () => {
    fetchMock.mockResolvedValue(
      okJson({ entries: [], summary: { ...summary, totalObligations: 0, inAlertWindow: 0, byKind: {} }, windowDays: 7 }),
    );
    await fetchUpcomingObligations('p1', { windowDays: 7 });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/sprint-k/p1/legal-calendar/upcoming?days=7',
    );
  });

  it('fetchUpcomingObligations → encodeURIComponent escapes the projectId', async () => {
    fetchMock.mockResolvedValue(
      okJson({ entries: [], summary: { ...summary, totalObligations: 0, inAlertWindow: 0, byKind: {} }, windowDays: 30 }),
    );
    await fetchUpcomingObligations('p/1 a');
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/sprint-k/p%2F1%20a/legal-calendar/upcoming?days=30',
    );
  });

  // ── fetchOverdueObligations ───────────────────────────────────────────

  it('fetchOverdueObligations → GET overdue, parsed payload', async () => {
    fetchMock.mockResolvedValue(okJson({ entries: [entry], count: 1 }));
    const out = await fetchOverdueObligations('p1');
    expect(out).toEqual({ entries: [entry], count: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/legal-calendar/overdue');
    expect((init as RequestInit).method).toBe('GET');
  });

  // ── acknowledgeObligation ─────────────────────────────────────────────

  it('acknowledgeObligation → POST acknowledge with the input as JSON body', async () => {
    fetchMock.mockResolvedValue(
      okJson({ obligation, nextDueAt: '2026-07-30T00:00:00.000Z', ackId: 'ack1' }),
    );
    const input = { obligation, notes: 'firmado' };
    const out = await acknowledgeObligation('p1', input);
    expect(out).toMatchObject({ ackId: 'ack1', nextDueAt: '2026-07-30T00:00:00.000Z' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/legal-calendar/acknowledge');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(input);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('acknowledgeObligation → attaches Idempotency-Key when provided', async () => {
    fetchMock.mockResolvedValue(
      okJson({ obligation, nextDueAt: '2026-07-30T00:00:00.000Z', ackId: 'ack1' }),
    );
    await acknowledgeObligation('p1', { obligation }, { idempotencyKey: 'idem-123' });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['Idempotency-Key']).toBe('idem-123');
  });

  it('acknowledgeObligation → omits Idempotency-Key when not provided', async () => {
    fetchMock.mockResolvedValue(
      okJson({ obligation, nextDueAt: '2026-07-30T00:00:00.000Z', ackId: 'ack1' }),
    );
    await acknowledgeObligation('p1', { obligation });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  // ── snoozeObligation ──────────────────────────────────────────────────

  it('snoozeObligation → POST snooze with the input as JSON body', async () => {
    fetchMock.mockResolvedValue(
      okJson({ obligation, snoozedUntil: '2026-06-20T00:00:00.000Z', snoozeId: 'sz1' }),
    );
    const input = {
      obligation,
      snoozeUntil: '2026-06-20T00:00:00.000Z',
      reason: 'esperando firma',
    };
    const out = await snoozeObligation('p1', input);
    expect(out).toMatchObject({ snoozeId: 'sz1', snoozedUntil: '2026-06-20T00:00:00.000Z' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/legal-calendar/snooze');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(input);
  });

  it('snoozeObligation → attaches Idempotency-Key when provided', async () => {
    fetchMock.mockResolvedValue(
      okJson({ obligation, snoozedUntil: '2026-06-20T00:00:00.000Z', snoozeId: 'sz1' }),
    );
    await snoozeObligation(
      'p1',
      { obligation, snoozeUntil: '2026-06-20T00:00:00.000Z', reason: 'x' },
      { idempotencyKey: 'idem-sz' },
    );
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['Idempotency-Key']).toBe('idem-sz');
  });

  // ── fetchObligationHistory ────────────────────────────────────────────

  it('fetchObligationHistory → GET history with default limit=100', async () => {
    fetchMock.mockResolvedValue(okJson({ entries: [], count: 0 }));
    const out = await fetchObligationHistory('p1');
    expect(out).toEqual({ entries: [], count: 0 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/legal-calendar/history?limit=100');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('fetchObligationHistory → honors a custom limit', async () => {
    fetchMock.mockResolvedValue(okJson({ entries: [], count: 0 }));
    await fetchObligationHistory('p1', { limit: 25 });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/sprint-k/p1/legal-calendar/history?limit=25',
    );
  });

  // ── error translation (shared json() helper) ──────────────────────────

  it('prefers body.message over body.error on a non-ok response', async () => {
    fetchMock.mockResolvedValue(
      errJson(422, { message: 'no_snooze_p0', error: 'unprocessable' }),
    );
    await expect(
      snoozeObligation('p1', {
        obligation,
        snoozeUntil: '2026-06-20T00:00:00.000Z',
        reason: 'x',
      }),
    ).rejects.toThrow('no_snooze_p0');
  });

  it('falls back to body.error when message is absent', async () => {
    fetchMock.mockResolvedValue(errJson(403, { error: 'forbidden' }));
    await expect(fetchOverdueObligations('p1')).rejects.toThrow('forbidden');
  });

  it('throws http_<status> when the error body has neither message nor error', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    await expect(fetchUpcomingObligations('p1')).rejects.toThrow('http_500');
  });

  it('tolerates an unparseable error body (falls back to http_<status>)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(fetchObligationHistory('p1')).rejects.toThrow('http_502');
  });

  // ── bundle accessor ───────────────────────────────────────────────────

  it('useLegalObligations bundle dispatches to the same underlying functions', async () => {
    expect(useLegalObligations.fetchUpcoming).toBe(fetchUpcomingObligations);
    expect(useLegalObligations.fetchOverdue).toBe(fetchOverdueObligations);
    expect(useLegalObligations.acknowledge).toBe(acknowledgeObligation);
    expect(useLegalObligations.snooze).toBe(snoozeObligation);
    expect(useLegalObligations.fetchHistory).toBe(fetchObligationHistory);

    fetchMock.mockResolvedValue(
      okJson({ entries: [], summary: { ...summary, totalObligations: 0, inAlertWindow: 0, byKind: {} }, windowDays: 30 }),
    );
    await useLegalObligations.fetchUpcoming('p9');
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/sprint-k/p9/legal-calendar/upcoming?days=30',
    );
  });
});
