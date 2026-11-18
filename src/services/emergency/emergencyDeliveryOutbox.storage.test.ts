import 'fake-indexeddb/auto';
import { del, get, set } from 'idb-keyval';
import { afterEach, expect, it } from 'vitest';
import { createIndexedDbEmergencyDeliveryAdapter } from './emergencyDeliveryOutbox';
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

afterEach(async () => { await del(key); });

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
