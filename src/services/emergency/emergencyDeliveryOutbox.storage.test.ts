import 'fake-indexeddb/auto';
import { del, get, set } from 'idb-keyval';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmergencyDeliveryController, createIndexedDbEmergencyDeliveryAdapter } from './emergencyDeliveryOutbox';
import type { EmergencyDeliveryPayload } from './emergencyDeliveryOutbox';
import type { OutboxEntry } from '../sync/genericOutboxEngine';

const key = 'praeventio:emergency-delivery-outbox:v1';
const entry: OutboxEntry<EmergencyDeliveryPayload> = {
  event: {
    clientEventId: 'event-1', kind: 'emergency_delivery', priority: 'critical',
    payload: { operation: 'triage', projectId: 'p1', workerId: 'w1', status: 'danger', triageLevel: 'rojo', occurredAt: '2026-09-17T10:00:00.000Z' },
    occurredAt: '2026-09-17T10:00:00.000Z',
  },
  queuedAt: '2026-09-17T10:00:00.000Z', retryCount: 0, nextRetryAt: 0,
};

vi.mock('../../lib/apiAuth', () => ({ apiAuthHeader: async () => 'Bearer test-token' }));

afterEach(async () => {
  vi.unstubAllGlobals();
  await del(key);
});

it('preserves an unexpected stored value on reads, saves and deletes', async () => {
  const retained = { entries: [entry], version: 'unknown' };
  await set(key, retained);
  const adapter = createIndexedDbEmergencyDeliveryAdapter();
  const results = await Promise.allSettled([
    adapter.listEntries(), adapter.saveEntry(entry), adapter.deleteEntry(entry.event.clientEventId),
  ]);
  expect(await get(key)).toEqual(retained);
  expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
  for (const result of results) {
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ message: 'emergency_delivery_outbox_invalid_storage' });
  }
});

it('accepts an absent store and reads a saved entry from a new adapter instance', async () => {
  const adapter = createIndexedDbEmergencyDeliveryAdapter();
  expect(await adapter.listEntries()).toEqual([]);
  await adapter.saveEntry(entry);
  expect(await createIndexedDbEmergencyDeliveryAdapter().listEntries()).toEqual([entry]);
  await adapter.deleteEntry(entry.event.clientEventId);
  expect(await adapter.listEntries()).toEqual([]);
});

it('publishes the matching acknowledgement for an offline entry replayed by a new submission', async () => {
  const connectivity = { onLine: false };
  vi.stubGlobal('navigator', connectivity);
  const fetchMock = vi.fn(async (_url: string, request: RequestInit) => {
    const id = new Headers(request.headers).get('Idempotency-Key');
    return Response.json({ accepted: true, persisted: true, serverEventId: id, delivered: false });
  });
  vi.stubGlobal('fetch', fetchMock);
  const id = entry.event.clientEventId;
  const nowMs = () => Date.parse(entry.queuedAt);
  const offline = createEmergencyDeliveryController({ adapter: createIndexedDbEmergencyDeliveryAdapter(), nowMs });
  await expect(offline.submit(entry.event.payload, { clientEventId: id })).resolves.toMatchObject({
    status: 'pending', queued: true,
  });
  expect(fetchMock).not.toHaveBeenCalled();

  const adapter = createIndexedDbEmergencyDeliveryAdapter();
  const resumed = createEmergencyDeliveryController({ adapter, nowMs });
  const observer = vi.fn();
  const unsubscribe = resumed.subscribe(id, observer);
  connectivity.onLine = true;
  try {
    await resumed.submit(entry.event.payload, { clientEventId: 'event-2' });
    expect(fetchMock.mock.calls.map(([, request]) => new Headers(request.headers).get('Idempotency-Key')).sort())
      .toEqual([id, 'event-2']);
    expect(await adapter.listEntries()).toEqual([]);
    expect(observer).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'accepted', queued: false, ack: { accepted: true, persisted: true, serverEventId: id, delivered: false },
    }));
  } finally {
    unsubscribe();
  }
});

it('replays a persisted emergency after controller restart and reconnect', async () => {
  const connectivity = { onLine: false };
  const browserEvents = new EventTarget();
  vi.stubGlobal('navigator', connectivity);
  vi.stubGlobal('window', browserEvents);
  const id = entry.event.clientEventId;
  const nowMs = () => Date.parse(entry.queuedAt);
  const fetchMock = vi.fn(async (_url: string, _request: RequestInit) =>
    Response.json({ accepted: true, persisted: true, serverEventId: id, delivered: false }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const offline = createEmergencyDeliveryController({ adapter: createIndexedDbEmergencyDeliveryAdapter(), nowMs });
  await expect(offline.submit(entry.event.payload, { clientEventId: id })).resolves.toMatchObject({
    status: 'pending', queued: true,
  });

  const adapter = createIndexedDbEmergencyDeliveryAdapter();
  const resumed = createEmergencyDeliveryController({ adapter, nowMs });
  expect(await adapter.listEntries()).toEqual([expect.objectContaining({ event: entry.event })]);
  const observer = vi.fn();
  const unsubscribe = resumed.subscribe(id, observer);
  try {
    resumed.registerOnReconnect();
    expect(fetchMock).not.toHaveBeenCalled();
    connectivity.onLine = true;
    browserEvents.dispatchEvent(new Event('online'));
    browserEvents.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(observer).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'accepted', queued: false, ack: { accepted: true, persisted: true, serverEventId: id, delivered: false },
    })));
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get('Idempotency-Key')).toBe(id);
    expect(await adapter.listEntries()).toEqual([]);
  } finally {
    unsubscribe();
  }
});
