import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry } from '../sync/genericOutboxEngine';
import type { IncidentReportPayload } from './incidentOutbox';

const state = vi.hoisted(() => ({
  entries: [] as OutboxEntry<IncidentReportPayload>[],
  readFailures: 0,
  beforeSave: undefined as Promise<void> | undefined,
}));
// Storage boundary only: scheduler and GenericOutboxEngine execute unchanged.
// Actual IndexedDB transaction semantics are covered by incidentOutbox.indexeddb.test.ts.
vi.mock('idb-keyval', () => ({
  get: async () => {
    if (state.readFailures > 0) {
      state.readFailures -= 1;
      throw new Error('synthetic storage read failure');
    }
    return structuredClone(state.entries);
  },
  update: async (_key: string, update: (value: typeof state.entries) => typeof state.entries) => {
    if (state.beforeSave) await state.beforeSave;
    state.entries = structuredClone(update(structuredClone(state.entries)));
  },
}));
vi.mock('../../lib/apiAuth', () => ({ apiAuthHeader: async () => 'Bearer synthetic-test' }));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn() } }));

let network: { onLine: boolean };
let events: EventTarget;
const fetchMock = vi.fn<typeof fetch>();
const payload: IncidentReportPayload = {
  id: 'retry-synthetic', projectId: 'test-project', incidentType: 'near_miss',
  severity: 'low', description: 'Synthetic retry regression', ts: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(payload.ts));
  state.entries = [];
  state.readFailures = 0;
  state.beforeSave = undefined;
  network = { onLine: false };
  events = new EventTarget();
  vi.stubGlobal('navigator', network);
  vi.stubGlobal('window', events);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  network.onLine = false;
  events.dispatchEvent(new Event('offline'));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('incident retry wake-up', () => {
  it('delivers after backoff without another online event or reload', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const outbox = await import('./incidentOutbox');
    await outbox.enqueueIncidentReport(payload, { clientEventId: payload.id });
    network.onLine = true;
    await outbox.flushIncidentReports();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.entries[0].retryCount).toBe(1);
    const due = state.entries[0].nextRetryAt;
    await vi.advanceTimersByTimeAsync(due - Date.now() + 250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.entries).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe(payload.id);
    }
  });

  it('cancels the wake-up offline and resumes on reconnect without spending retries offline', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const outbox = await import('./incidentOutbox');
    await outbox.enqueueIncidentReport(payload, { clientEventId: payload.id });
    network.onLine = true;
    await outbox.flushIncidentReports();
    network.onLine = false;
    events.dispatchEvent(new Event('offline'));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.entries[0].retryCount).toBe(1);
    network.onLine = true;
    events.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.entries).toHaveLength(0);
  });


  it('coalesces repeated reconnects and flushes without bypassing backoff', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const outbox = await import('./incidentOutbox');
    await outbox.enqueueIncidentReport(payload, { clientEventId: payload.id });
    network.onLine = true;
    await Promise.all(Array.from({ length: 8 }, () => outbox.flushIncidentReports()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const due = state.entries[0].nextRetryAt;
    for (let i = 0; i < 8; i += 1) events.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(due - Date.now() - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.entries).toHaveLength(0);
  });

  it('restores a future retry deadline at startup without sending early', async () => {
    const outbox = await import('./incidentOutbox');
    await outbox.enqueueIncidentReport(payload, { clientEventId: payload.id });
    state.entries[0].nextRetryAt = Date.now() + 4_000;
    network.onLine = true;
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    outbox.registerIncidentFlushOnReconnect();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(251);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.entries).toHaveLength(0);
  });

  it('retains dead letters without scheduling or sending them', async () => {
    const outbox = await import('./incidentOutbox');
    await outbox.enqueueIncidentReport(payload, { clientEventId: payload.id });
    state.entries[0].deadLettered = true;
    state.entries[0].nextRetryAt = Infinity;
    network.onLine = true;
    await outbox.flushIncidentReports();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.entries).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers from storage read failures without treating retained data as empty', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const outbox = await import('./incidentOutbox');
    await outbox.enqueueIncidentReport(payload, { clientEventId: payload.id });
    network.onLine = true;
    await outbox.flushIncidentReports();
    state.readFailures = 2;
    await expect(outbox.flushIncidentReports()).rejects.toThrow('synthetic storage read failure');
    expect(state.entries).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.entries).toHaveLength(0);
  });

  it('starts delivery only after a slow durable enqueue commits', async () => {
    let release!: () => void;
    state.beforeSave = new Promise<void>((resolve) => { release = resolve; });
    network.onLine = true;
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    const outbox = await import('./incidentOutbox');
    const enqueue = outbox.enqueueIncidentReport(payload, { clientEventId: payload.id });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    await enqueue;
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.entries).toHaveLength(0);
  });
});
