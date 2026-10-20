// OLA 1 (VIDA, 2026-06-14) — IndexedDbSosStorage (prod persistence for the SOS
// outbox). Pins: save→load round-trip, empty→[], and read failures propagating
// (never returning [] — that would let the next enqueue overwrite the queue).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted — share the mocks via vi.hoisted so they exist
// before the hoisted factory runs.
const h = vi.hoisted(() => {
  const mem = new Map<string, unknown>();
  return {
    mem,
    getMock: vi.fn(async (k: string) => mem.get(k)),
    setMock: vi.fn(async (k: string, v: unknown) => {
      mem.set(k, v);
    }),
    warnMock: vi.fn(),
  };
});
vi.mock('idb-keyval', () => ({ get: h.getMock, set: h.setMock }));
vi.mock('../../utils/logger', () => ({ logger: { warn: h.warnMock, error: vi.fn() } }));

import { IndexedDbSosStorage } from './sosOutbox.indexeddb';
import type { OutboxEntry } from './sosOutbox';

const entry = (id: string): OutboxEntry => ({
  event: { clientEventId: id, workerUid: 'w1', reason: 'manual_button', projectId: 'p1', occurredAt: '2026-06-14T00:00:00Z' },
  queuedAt: '2026-06-14T00:00:00Z',
  retryCount: 0,
  nextRetryAt: 0,
});

describe('IndexedDbSosStorage', () => {
  beforeEach(() => {
    h.mem.clear();
    h.getMock.mockClear();
    h.setMock.mockClear();
    h.warnMock.mockClear();
  });

  it('round-trips entries through save → load', async () => {
    const store = new IndexedDbSosStorage();
    await store.save([entry('a'), entry('b')]);
    const loaded = await store.load();
    expect(loaded.map((e) => e.event.clientEventId)).toEqual(['a', 'b']);
  });

  it('returns [] when nothing has been persisted', async () => {
    expect(await new IndexedDbSosStorage().load()).toEqual([]);
  });

  it('propagates read failures instead of returning an empty queue', async () => {
    h.getMock.mockRejectedValueOnce(new Error('IDB unavailable (private mode)'));
    await expect(new IndexedDbSosStorage().load()).rejects.toThrow(
      'IDB unavailable (private mode)',
    );
    expect(h.warnMock).toHaveBeenCalled();
  });

  it('propagates non-array corruption instead of overwriting the stored value', async () => {
    h.mem.set('praeventio:sos-outbox:v1', { corrupt: true });
    await expect(new IndexedDbSosStorage().load()).rejects.toThrow(
      'sos_outbox_corrupt',
    );
  });

  it('propagates save errors so the caller knows the SOS was NOT persisted', async () => {
    h.setMock.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(new IndexedDbSosStorage().save([entry('a')])).rejects.toThrow('quota exceeded');
  });
});
