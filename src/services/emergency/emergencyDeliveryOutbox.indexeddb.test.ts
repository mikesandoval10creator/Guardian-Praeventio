// Emergency delivery outbox — IndexedDB adapter durability.
//
// The adapter must use idb-keyval's atomic `update` for read-modify-write.
// A `get` → mutate → `set` sequence loses packets when a flush and an
// enqueue overlap. A failed read must also propagate: returning [] would
// make the caller believe the queue is empty and overwrite retained
// emergency evidence with a single new packet.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const mem = new Map<string, unknown>();
  const getMock = vi.fn(async (key: string) => mem.get(key));
  const updateMock = vi.fn(
    async (key: string, updater: (oldValue: unknown) => unknown) => {
      mem.set(key, updater(mem.get(key)));
    },
  );
  return { mem, getMock, updateMock };
});

vi.mock('idb-keyval', () => ({ get: h.getMock, update: h.updateMock }));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  createIndexedDbEmergencyDeliveryAdapter,
  type EmergencyDeliveryPayload,
} from './emergencyDeliveryOutbox';
import type { OutboxEntry } from '../sync/genericOutboxEngine';

const payload: EmergencyDeliveryPayload = {
  operation: 'triage',
  projectId: 'project-1',
  workerId: 'worker-1',
  status: 'danger',
  triageLevel: 'rojo',
  occurredAt: '2026-09-17T10:00:00.000Z',
};

function entry(id: string): OutboxEntry<EmergencyDeliveryPayload> {
  return {
    event: {
      clientEventId: id,
      kind: 'emergency_delivery',
      priority: 'critical',
      payload,
      occurredAt: payload.occurredAt,
    },
    queuedAt: '2026-09-17T10:00:00.000Z',
    retryCount: 0,
    nextRetryAt: 0,
  };
}

beforeEach(() => {
  h.mem.clear();
  h.getMock.mockClear();
  h.updateMock.mockClear();
});

describe('createIndexedDbEmergencyDeliveryAdapter', () => {
  it('uses atomic update and preserves concurrent saves', async () => {
    const adapter = createIndexedDbEmergencyDeliveryAdapter();

    await Promise.all([
      adapter.saveEntry(entry('a')),
      adapter.saveEntry(entry('b')),
    ]);

    const list = await adapter.listEntries();
    expect(
      list.map((item) => item.event.clientEventId).sort(),
    ).toEqual(['a', 'b']);
    expect(h.updateMock).toHaveBeenCalledTimes(2);
  });

  it('deleteEntry removes only the target and keeps the rest', async () => {
    const adapter = createIndexedDbEmergencyDeliveryAdapter();
    await adapter.saveEntry(entry('a'));
    await adapter.saveEntry(entry('b'));

    await adapter.deleteEntry('a');

    const list = await adapter.listEntries();
    expect(list.map((item) => item.event.clientEventId)).toEqual(['b']);
  });

  it('propagates a read failure instead of returning an empty queue', async () => {
    h.getMock.mockRejectedValueOnce(new Error('IDB down'));
    const adapter = createIndexedDbEmergencyDeliveryAdapter();

    await expect(adapter.listEntries()).rejects.toThrow('IDB down');
  });
});
