import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry, SosEvent } from './sosOutbox';

// Keep the real client, engine and IndexedDB adapter. Replace only disk/network.
const disk = vi.hoisted(() => ({ entries: [] as OutboxEntry[] }));
vi.mock('idb-keyval', () => ({
  get: async () => structuredClone(disk.entries),
  set: async (_key: string, entries: OutboxEntry[]) => {
    disk.entries = structuredClone(entries);
  },
}));
vi.mock('../../lib/apiAuth', () => ({ apiAuthHeader: async () => 'Bearer test' }));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const event: SosEvent = {
  clientEventId: 'durable-sos', workerUid: 'worker', projectId: 'project',
  reason: 'manual_button', occurredAt: '2026-10-05T00:00:00Z',
};
let browser: EventTarget;
let documentEvents: EventTarget & { visibilityState: string };
let fetchNetwork: ReturnType<typeof vi.fn>;
async function settle() {
  // All I/O in this harness resolves as microtasks; no wall-clock sleeps.
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  disk.entries = [];
  browser = new EventTarget();
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('navigator', { onLine: true });
  fetchNetwork = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', fetchNetwork);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('durable SOS client lifecycle', () => {
  it('persists a first online SOS before sending it without another browser event', async () => {
    const observed: string[] = [];
    fetchNetwork.mockImplementation(async () => {
      observed.push(...disk.entries.map(entry => entry.event.clientEventId));
      return { ok: true };
    });
    const client = await import('./sosOutboxClient');
    await client.enqueueSos(event);
    await settle();
    expect(observed).toEqual(['durable-sos']);
    expect(disk.entries).toEqual([]);
  });

  it('retries at nextRetryAt while online without requiring reconnect', async () => {
    fetchNetwork.mockResolvedValueOnce({ ok: false, status: 503 });
    const client = await import('./sosOutboxClient');
    await client.enqueueSos(event);
    await settle();
    expect(disk.entries).toHaveLength(1);
    expect(disk.entries[0].retryCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(disk.entries).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(disk.entries).toEqual([]);
    expect(fetchNetwork.mock.calls.map(call => call[1].headers['Idempotency-Key']))
      .toEqual(['durable-sos', 'durable-sos']);
  });

  it('restores persisted entries on startup and prevents duplicate simultaneous drains', async () => {
    disk.entries = [{ event, queuedAt: event.occurredAt, retryCount: 0, nextRetryAt: Date.now() }];
    let finish!: (response: { ok: boolean }) => void;
    fetchNetwork.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const client = await import('./sosOutboxClient');
    client.registerSosFlushOnReconnect();
    client.registerSosFlushOnReconnect();
    browser.dispatchEvent(new Event('online'));
    await settle();
    expect(fetchNetwork).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await settle();
    expect(disk.entries).toEqual([]);
  });

  it('drains on resume when an offline session regains visibility', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const client = await import('./sosOutboxClient');
    await client.enqueueSos(event);
    await settle();
    expect(disk.entries).toHaveLength(1);
    expect(fetchNetwork).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true });
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(disk.entries).toEqual([]);
  });

  it('bounds a stalled HTTP request to 15 seconds and retains the SOS for retry', async () => {
    let signal!: AbortSignal;
    fetchNetwork.mockImplementation((_url, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const client = await import('./sosOutboxClient');
    let result: Awaited<ReturnType<typeof client.sendSos>> | undefined;
    void client.sendSos(event).then(value => { result = value; });
    await settle();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(result).toEqual({ ok: false, error: 'sos_timeout' });
  });
});
