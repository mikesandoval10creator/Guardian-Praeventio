import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupSystemEngineTrigger } from './systemEngineTrigger';

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
