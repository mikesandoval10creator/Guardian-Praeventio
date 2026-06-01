// Tests for the shift-handover API client (6 mutators) + the 4 orphan-UI
// stubs (rescue-450 PR #501). Vital: the mutators are how the supervisor's
// shift lifecycle (start → log → note → end → acknowledge → summarize)
// reaches the server. We assert the path/method/body/auth-header contract and
// the error translation (server error string vs http_<status>), mirroring
// useEvacuation.test.ts. The stubs are pinned to their placeholder shape per
// the anti-stub-disfrazado convention (CLAUDE.md #13).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import {
  startShiftApi,
  logShiftEntryApi,
  addShiftNoteApi,
  endShiftApi,
  acknowledgeShiftApi,
  summarizeShiftApi,
  fetchShiftHandoverHistory,
  createShiftHandover,
  acknowledgeShiftHandover,
  addShiftHandoverDiscrepancy,
} from './useShiftHandover';

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

const shift = { id: 's1', projectId: 'p1' } as never;

describe('useShiftHandover API client', () => {
  it('startShiftApi → POST start, parsed shift, auth + json headers, body', async () => {
    fetchMock.mockResolvedValue(okJson({ shift: { id: 's1', kind: 'day' } }));
    const out = await startShiftApi('p1', { id: 's1', kind: 'day' as never });
    expect(out.shift).toEqual({ id: 's1', kind: 'day' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/shift-handover/start');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      id: 's1',
      kind: 'day',
    });
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('logShiftEntryApi → POST log-entry with shift+entry body', async () => {
    fetchMock.mockResolvedValue(okJson({ shift: { id: 's1' } }));
    const entry = { kind: 'note', text: 'all good' } as never;
    const out = await logShiftEntryApi('p1', { shift, entry });
    expect(out.shift).toEqual({ id: 's1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/shift-handover/log-entry');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ shift, entry });
  });

  it('addShiftNoteApi → POST add-note with shift+note body', async () => {
    fetchMock.mockResolvedValue(okJson({ shift: { id: 's1' } }));
    const note = { text: 'watch valve A', severity: 'urgent' } as never;
    const out = await addShiftNoteApi('p1', { shift, note });
    expect(out.shift).toEqual({ id: 's1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/shift-handover/add-note');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ shift, note });
  });

  it('endShiftApi → POST end', async () => {
    fetchMock.mockResolvedValue(okJson({ shift: { id: 's1', endedAt: 'now' } }));
    const out = await endShiftApi('p1', { shift });
    expect(out.shift).toMatchObject({ endedAt: 'now' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sprint-k/p1/shift-handover/end');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      shift,
    });
  });

  it('acknowledgeShiftApi → POST acknowledge with optional notes', async () => {
    fetchMock.mockResolvedValue(okJson({ shift: { id: 's1', acknowledged: true } }));
    const out = await acknowledgeShiftApi('p1', { shift, notes: 'received' });
    expect(out.shift).toMatchObject({ acknowledged: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/sprint-k/p1/shift-handover/acknowledge');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      shift,
      notes: 'received',
    });
  });

  it('summarizeShiftApi → POST summarize, parsed summary', async () => {
    fetchMock.mockResolvedValue(okJson({ summary: { headline: 'quiet shift', risks: [] } }));
    const out = await summarizeShiftApi('p1', { shift });
    expect(out.summary).toMatchObject({ headline: 'quiet shift' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sprint-k/p1/shift-handover/summarize');
  });

  it('throws the server-provided error string on a non-ok response', async () => {
    fetchMock.mockResolvedValue(errJson(403, { error: 'forbidden' }));
    await expect(startShiftApi('p1', { id: 's1', kind: 'day' as never })).rejects.toThrow(
      'forbidden',
    );
  });

  it('throws http_<status> when the error body has no error field', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    await expect(endShiftApi('p1', { shift })).rejects.toThrow('http_500');
  });

  it('tolerates an unparseable error body (falls back to http_<status>)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(summarizeShiftApi('p1', { shift })).rejects.toThrow('http_502');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Orphan-UI stubs (rescue-450 PR #501). These do NOT hit the network yet —
// they return fixed placeholder shapes so the not-yet-mounted panels can
// typecheck + render their optimistic/empty branches. We pin the shapes
// (CLAUDE.md #13) and assert no fetch is issued.
// ──────────────────────────────────────────────────────────────────────

describe('useShiftHandover orphan-UI stubs', () => {
  it('fetchShiftHandoverHistory returns an empty shifts array without fetching', async () => {
    const out = await fetchShiftHandoverHistory('p1', { days: 30 });
    expect(out).toEqual({ shifts: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createShiftHandover echoes a minimal shift built from the input (no fetch)', async () => {
    const out = await createShiftHandover(
      'p1',
      {
        id: 's9',
        kind: 'night' as never,
        startedAt: '2026-06-01T00:00:00.000Z',
        supervisorUid: 'sup-1',
        logEntries: [{ kind: 'note', text: 'hi' }] as never,
        handoverNotes: [{ text: 'note' }] as never,
      },
      'idem-key-1',
    );
    expect(out.shift).toMatchObject({
      id: 's9',
      projectId: 'p1',
      kind: 'night',
      startedAt: '2026-06-01T00:00:00.000Z',
      supervisorUid: 'sup-1',
      logEntries: [{ kind: 'note', text: 'hi' }],
      handoverNotes: [{ text: 'note' }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('acknowledgeShiftHandover returns a typed shell carrying the shiftId (no fetch)', async () => {
    const out = await acknowledgeShiftHandover('p1', 's5', { notes: 'ok' }, 'idem-key-2');
    expect(out.shift).toMatchObject({ id: 's5' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('addShiftHandoverDiscrepancy returns a typed shell carrying the shiftId (no fetch)', async () => {
    const out = await addShiftHandoverDiscrepancy(
      'p1',
      's7',
      { text: 'mismatch' },
      'idem-key-3',
    );
    expect(out.shift).toMatchObject({ id: 's7' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
