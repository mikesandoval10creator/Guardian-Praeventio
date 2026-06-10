import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeSystemEventAuditor, setupSystemEngineTrigger } from './systemEngineTrigger';

interface FakeChange {
  type: 'added' | 'modified' | 'removed';
  doc: { id: string; data: () => Record<string, unknown> };
}

let listeners: Array<(snap: { docChanges: () => FakeChange[] }) => void> = [];
let errorHandlers: Array<(err: Error) => void> = [];

function makeFakeDb() {
  const db = {
    collectionGroup: vi.fn().mockImplementation((_name: string) => ({
      onSnapshot: vi.fn().mockImplementation((onNext, onError) => {
        listeners.push(onNext);
        errorHandlers.push(onError);
        return () => {};
      }),
    })),
  };
  return db as unknown as Parameters<typeof setupSystemEngineTrigger>[0]['db'];
}

afterEach(() => {
  listeners = [];
  errorHandlers = [];
  vi.clearAllMocks();
});

describe('systemEngineTrigger', () => {
  it('skips initial-load snapshot to avoid replaying historical events on boot', () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    setupSystemEngineTrigger({ db: makeFakeDb(), onEvent });

    const wellFormed = makeWellFormedEvent('e1');
    listeners[0]({
      docChanges: () => [{ type: 'added', doc: { id: 'e1', data: () => wellFormed } }],
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('invokes onEvent for new events past the initial load', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    setupSystemEngineTrigger({ db: makeFakeDb(), onEvent });

    listeners[0]({ docChanges: () => [] }); // initial load
    const wellFormed = makeWellFormedEvent('e2');
    listeners[0]({
      docChanges: () => [{ type: 'added', doc: { id: 'e2', data: () => wellFormed } }],
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed events without throwing', () => {
    const onEvent = vi.fn();
    setupSystemEngineTrigger({ db: makeFakeDb(), onEvent });

    listeners[0]({ docChanges: () => [] });
    listeners[0]({
      docChanges: () => [{ type: 'added', doc: { id: 'bad', data: () => ({ broken: true }) } }],
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('absorbs onEvent errors so a single bad listener does not stop the trigger', async () => {
    const onEvent = vi.fn().mockRejectedValue(new Error('boom'));
    setupSystemEngineTrigger({ db: makeFakeDb(), onEvent });

    listeners[0]({ docChanges: () => [] });
    const ev = makeWellFormedEvent('e3');
    expect(() =>
      listeners[0]({
        docChanges: () => [{ type: 'added', doc: { id: 'e3', data: () => ev } }],
      }),
    ).not.toThrow();
  });
});

function makeWellFormedEvent(id: string) {
  return {
    id,
    tenantId: 'tA',
    projectId: 'pA',
    actorUid: 'u1',
    ts: 1,
    idempotencyKey: id,
    type: 'fall_detected',
    payload: { workerId: 'u1', projectId: 'pA', confidence: 0.9, accelMagnitude: 30 },
  };
}

// AUDIT-2026-06 B19 — the trigger header promised "Phase 1: persists a
// server-side audit log for every system event", but server.ts never
// passed an onEvent, so the listener validated + deduped and then did
// NOTHING. makeSystemEventAuditor is the Phase 1 hook, wired in server.ts.
describe('makeSystemEventAuditor', () => {
  function makeAuditDb() {
    const sets: Array<{ id: string; data: Record<string, unknown> }> = [];
    const db = {
      collection: vi.fn().mockImplementation((name: string) => ({
        doc: (id: string) => ({
          set: async (data: Record<string, unknown>) => {
            if (name === 'audit_logs') sets.push({ id, data });
          },
        }),
      })),
    };
    return { db: db as unknown as Parameters<typeof makeSystemEventAuditor>[0], sets };
  }

  const event = {
    id: 'evt-1',
    type: 'sos_triggered',
    tenantId: 'tenant-a',
    projectId: 'proj-1',
    actorUid: 'uid-worker',
    ts: 1765000000000,
    idempotencyKey: 'ik-1',
    payload: { lat: -33.4, lng: -70.6 },
  } as never;

  it('writes an idempotent audit_logs row keyed by the event id', async () => {
    const { db, sets } = makeAuditDb();
    const auditor = makeSystemEventAuditor(db, () => 'SERVER_TS');
    await auditor(event);
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe('sysevent_evt-1');
    expect(sets[0].data).toMatchObject({
      action: 'system_event_sos_triggered',
      module: 'systemEngine',
      userId: 'uid-worker',
      tenantId: 'tenant-a',
      projectId: 'proj-1',
      eventId: 'evt-1',
      idempotencyKey: 'ik-1',
      eventTs: 1765000000000,
      timestamp: 'SERVER_TS',
    });
  });

  it('records system as actor when the event has no actorUid', async () => {
    const { db, sets } = makeAuditDb();
    const auditor = makeSystemEventAuditor(db, () => 'SERVER_TS');
    await auditor({ ...(event as Record<string, unknown>), actorUid: null } as never);
    expect(sets[0].data.userId).toBe('system');
  });
});
