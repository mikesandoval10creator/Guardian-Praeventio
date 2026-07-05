// auditOutbox: transport classification + engine integration.
//
// Pins §14: the sender NEVER classifies 'permanent_failure' (the engine would
// DELETE the audit entry — silent loss of compliance data). Any failure retries;
// exhaustion dead-letters (retained), which the generic engine's own suite covers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
}));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { sendAuditLog, type AuditLogOutboxPayload } from './auditOutbox';
import {
  GenericOutboxEngine,
  createInMemoryOutboxAdapter,
  type OutboxEvent,
} from '../sync/genericOutboxEngine';

const payload: AuditLogOutboxPayload = {
  action: 'CREATE_FINDING',
  module: 'Findings',
  details: { findingId: 'f-1', severity: 'Alta' },
  projectId: 'p1',
};

const event: OutboxEvent<AuditLogOutboxPayload> = {
  clientEventId: 'audit-abc',
  kind: 'audit',
  priority: 'background',
  payload,
  occurredAt: '2026-07-05T10:00:00Z',
};

const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendAuditLog (transport)', () => {
  it('POSTs to /api/audit-log with Idempotency-Key = clientEventId and auth', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    const result = await sendAuditLog(event);
    expect(result.kind).toBe('success');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/audit-log');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('audit-abc');
    expect(headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(String(init.body)) as AuditLogOutboxPayload;
    expect(body.action).toBe('CREATE_FINDING');
    expect(body.module).toBe('Findings');
    expect(body.projectId).toBe('p1');
  });

  it('classifies 5xx as retry', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    expect(await sendAuditLog(event)).toEqual({ kind: 'retry', error: 'HTTP 503' });
  });

  it('classifies 4xx as retry too — NEVER permanent_failure (audit trail must not be dropped, §14)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 } as Response);
    const result = await sendAuditLog(event);
    expect(result.kind).toBe('retry'); // exhaustion → dead-letter (retained), not deletion
    expect(result.error).toBe('HTTP 400');
  });

  it('classifies a network throw as retry with the error message', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    expect(await sendAuditLog(event)).toEqual({ kind: 'retry', error: 'Failed to fetch' });
  });
});

describe('engine integration (in-memory adapter + real transport)', () => {
  it('retains a failed audit event and delivers it on a later flush with the SAME key', async () => {
    let now = 1_000_000;
    const adapter = createInMemoryOutboxAdapter<AuditLogOutboxPayload>();
    const engine = new GenericOutboxEngine<AuditLogOutboxPayload>({
      adapter,
      sender: sendAuditLog,
      nowMs: () => now,
    });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await engine.enqueue(event);
    const first = await engine.flush();
    expect(first.retried).toBe(1);
    expect(await adapter.listEntries()).toHaveLength(1); // retained, not lost

    now += 60_000; // past the backoff
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const second = await engine.flush();
    expect(second.succeeded).toBe(1);
    expect(await adapter.listEntries()).toHaveLength(0); // delivered + cleared

    // Both attempts carried the SAME Idempotency-Key → server can dedupe.
    const keys = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit).headers as Record<string, string>,
    );
    expect(keys[0]['Idempotency-Key']).toBe('audit-abc');
    expect(keys[1]['Idempotency-Key']).toBe('audit-abc');
  });

  it('enqueue is idempotent by clientEventId (a retried flush cannot duplicate)', async () => {
    const adapter = createInMemoryOutboxAdapter<AuditLogOutboxPayload>();
    const engine = new GenericOutboxEngine<AuditLogOutboxPayload>({
      adapter,
      sender: sendAuditLog,
    });
    await engine.enqueue(event);
    await engine.enqueue(event);
    expect(await adapter.listEntries()).toHaveLength(1);
  });
});
