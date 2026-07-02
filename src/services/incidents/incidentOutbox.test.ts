// B.1 (VIDA) — incidentOutbox: transport classification + engine integration.
//
// Pins the honesty rule: the sender NEVER classifies 'permanent_failure'
// (the engine would DELETE the entry — silent loss of safety data). Any
// failure retries; exhaustion dead-letters (retained), which the generic
// engine's own suite covers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
}));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { sendIncidentReport, type IncidentReportPayload } from './incidentOutbox';
import {
  GenericOutboxEngine,
  createInMemoryOutboxAdapter,
  type OutboxEvent,
} from '../sync/genericOutboxEngine';

const payload: IncidentReportPayload = {
  id: 'inc-abc',
  projectId: 'p1',
  incidentType: 'near_miss',
  severity: 'med',
  description: 'Casi golpe por carga suspendida',
  ts: '2026-07-01T10:00:00Z',
};

const event: OutboxEvent<IncidentReportPayload> = {
  clientEventId: 'inc-abc',
  kind: 'incident',
  priority: 'normal',
  payload,
  occurredAt: payload.ts,
};

const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendIncidentReport (transport)', () => {
  it('POSTs to the audited endpoint with Idempotency-Key = clientEventId and auth', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    const result = await sendIncidentReport(event);
    expect(result.kind).toBe('success');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/incidents/report');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('inc-abc');
    expect(headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(String(init.body)) as IncidentReportPayload;
    expect(body.id).toBe('inc-abc'); // deterministic doc id = clientEventId
    expect(body.projectId).toBe('p1');
    expect(body.description).toContain('carga suspendida');
  });

  it('classifies 5xx as retry', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    const result = await sendIncidentReport(event);
    expect(result).toEqual({ kind: 'retry', error: 'HTTP 503' });
  });

  it('classifies 4xx as retry too — NEVER permanent_failure (engine would delete the safety record)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 } as Response);
    const result = await sendIncidentReport(event);
    expect(result.kind).toBe('retry'); // exhaustion → dead-letter (retained), not deletion
    expect(result.error).toBe('HTTP 400');
  });

  it('classifies a network throw as retry with the error message', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    const result = await sendIncidentReport(event);
    expect(result).toEqual({ kind: 'retry', error: 'Failed to fetch' });
  });
});

describe('engine integration (in-memory adapter + real transport)', () => {
  it('retains a failed report and delivers it on a later flush with the SAME key', async () => {
    let now = 1_000_000;
    const adapter = createInMemoryOutboxAdapter<IncidentReportPayload>();
    const engine = new GenericOutboxEngine<IncidentReportPayload>({
      adapter,
      sender: sendIncidentReport,
      nowMs: () => now,
    });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await engine.enqueue(event);
    const first = await engine.flush();
    expect(first.retried).toBe(1);
    expect((await adapter.listEntries())).toHaveLength(1); // retained, not lost

    // Signal back: advance past the backoff and flush again.
    now += 60_000;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const second = await engine.flush();
    expect(second.succeeded).toBe(1);
    expect(await adapter.listEntries()).toHaveLength(0); // delivered + cleared

    // Both attempts carried the SAME Idempotency-Key → server can dedupe.
    const keys = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit).headers as Record<string, string>,
    );
    expect(keys[0]['Idempotency-Key']).toBe('inc-abc');
    expect(keys[1]['Idempotency-Key']).toBe('inc-abc');
  });

  it('enqueue is idempotent by clientEventId (re-tap cannot duplicate)', async () => {
    const adapter = createInMemoryOutboxAdapter<IncidentReportPayload>();
    const engine = new GenericOutboxEngine<IncidentReportPayload>({
      adapter,
      sender: sendIncidentReport,
    });
    await engine.enqueue(event);
    await engine.enqueue(event);
    expect(await adapter.listEntries()).toHaveLength(1);
  });
});
