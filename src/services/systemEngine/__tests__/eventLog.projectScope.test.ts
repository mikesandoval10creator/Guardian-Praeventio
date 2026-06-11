// SystemEngine — eventLog project re-scope (A4 remediation).
//
// The bus path `tenants/{tid}/system_events` was doubly dead in prod:
// `__GP_TENANT_ID__` is never assigned (every install fell to 'default')
// AND firestore.rules has no `system_events` block under the tenants
// catch-all (`create:false`) — so every cross-device write was
// PERMISSION_DENIED. These tests pin the make-real decision: events
// persist under `projects/{projectId}/system_events/{eventId}` (the real
// tenancy unit), and with NO project the engine stays explicitly
// local-only (in-process listeners fire; no Firestore write, no outbox).

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => ({
  setDoc: vi.fn(async (_ref: unknown, _data: unknown) => undefined),
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ __path: path, __id: id })),
}));

vi.mock('firebase/firestore', () => ({
  setDoc: H.setDoc,
  doc: H.doc,
  addDoc: vi.fn(),
  collection: vi.fn((_db: unknown, path: string) => ({ __collection: path })),
  serverTimestamp: () => ({ __serverTs: true }),
}));
vi.mock('../../firebase', () => ({ db: { __fake: true }, auth: { currentUser: null } }));
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { openDB } from 'idb';
import { emit, drainOutbox, onLocalEmit, __resetForTests } from '../eventLog';
import type { SystemEvent } from '../eventTypes';

let seq = 0;
function tierChangedEvent(over: Partial<SystemEvent> = {}): SystemEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    tenantId: 'default',
    actorUid: 'u1',
    ts: 1_717_000_000_000,
    idempotencyKey: `idem-${seq}`,
    type: 'tier_changed',
    payload: { userId: 'u1', fromTier: 'free', toTier: 'pro', source: 'webhook' },
    ...over,
  } as SystemEvent;
}

beforeEach(async () => {
  await __resetForTests();
  H.setDoc.mockClear();
  H.doc.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('eventLog — project-scoped Firestore path', () => {
  it('writes to projects/{projectId}/system_events when the envelope carries a projectId', async () => {
    const event = tierChangedEvent({ projectId: 'p1' });
    const result = await emit(event);

    expect(result.ok).toBe(true);
    expect(result.queued).toBeUndefined();
    expect(H.setDoc).toHaveBeenCalledTimes(1);
    expect(H.doc).toHaveBeenCalledWith(
      expect.anything(),
      'projects/p1/system_events',
      event.id,
    );
  });

  it('stays local-only when no project is selected: ok, no Firestore write, no throw', async () => {
    const seen: SystemEvent[] = [];
    onLocalEmit((e) => seen.push(e));

    const event = tierChangedEvent(); // no envelope projectId
    const result = await emit(event);

    expect(result.ok).toBe(true);
    // In-process subscribers still fire — the engine keeps working locally.
    expect(seen.map((e) => e.id)).toContain(event.id);
    // But the cross-device hop is explicitly skipped (not errored, not queued).
    expect(H.setDoc).not.toHaveBeenCalled();
    expect(result.queued).toBeUndefined();
  });

  it('never enqueues a project-less event in the offline outbox', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const result = await emit(tierChangedEvent());
    expect(result.ok).toBe(true);
    expect(result.queued).toBeUndefined();

    vi.stubGlobal('navigator', { onLine: true });
    const counts = await drainOutbox();
    expect(counts).toEqual({ drained: 0, failed: 0 });
    expect(H.setDoc).not.toHaveBeenCalled();
  });

  it('drainOutbox re-targets queued events to projects/{projectId}/system_events', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const event = tierChangedEvent({ projectId: 'p9' });
    const queued = await emit(event);
    expect(queued.queued).toBe(true);
    expect(H.setDoc).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', { onLine: true });
    const counts = await drainOutbox();
    expect(counts).toEqual({ drained: 1, failed: 0 });
    expect(H.doc).toHaveBeenCalledWith(
      expect.anything(),
      'projects/p9/system_events',
      event.id,
    );
  });

  it('drainOutbox drops legacy outbox records without projectId (undeliverable) instead of looping forever', async () => {
    // Simulate a record enqueued by the pre-rescope code (tenant-pathed,
    // no envelope projectId). It can never be delivered to a project bus.
    const idb = await openDB('praeventio-systemengine', 1);
    await idb.put('system_events_outbox', {
      ...tierChangedEvent(),
      _enqueuedAt: Date.now(),
    });

    const counts = await drainOutbox();
    expect(counts).toEqual({ drained: 0, failed: 0 });
    expect(H.setDoc).not.toHaveBeenCalled();
    // The poison record was removed — a later drain doesn't see it again.
    const remaining = await idb.getAll('system_events_outbox');
    expect(remaining).toEqual([]);
  });
});
