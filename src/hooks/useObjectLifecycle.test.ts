// Praeventio Guard — useObjectLifecycle unit tests.
//
// We exercise the pure runner `runObjectLifecycle` directly (the hook
// is a thin `useCallback` wrapper). This avoids needing jsdom or a
// React test renderer.

import { describe, expect, it, vi } from 'vitest';

// Mock firebase before importing the hook module — `db` etc. trigger app
// init at import time otherwise.
vi.mock('../services/firebase', () => ({
  db: {} as unknown,
  collection: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__'),
}));

import { runObjectLifecycle } from './useObjectLifecycle';
import type { PlacedObject } from '../services/digitalTwin/photogrammetry/types';

function makeObject(overrides: Partial<PlacedObject> = {}): PlacedObject {
  return {
    id: 'obj-1',
    kind: 'extinguisher_pqs',
    position: { x: 1, y: 0, z: 1 },
    lifecycle: 'planning',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeDeps() {
  const addNode = vi.fn(async () => ({ id: 'node-1' }));
  const addCalendarEvent = vi.fn(async () => ({ id: 'cal-1' }));
  return {
    addNode,
    addCalendarEvent,
    deps: {
      projectId: 'proj-1',
      actorUserId: 'user-1',
      addNode: addNode as unknown as (n: any) => Promise<unknown>,
      addCalendarEvent: addCalendarEvent as unknown as (
        d: Record<string, unknown>,
      ) => Promise<unknown>,
    },
  };
}

describe('runObjectLifecycle', () => {
  it('first install (planning -> installed) writes 1 ZK node and >=2 calendar events for PQS extinguisher', async () => {
    const { addNode, addCalendarEvent, deps } = makeDeps();
    const previous = makeObject({ lifecycle: 'planning' });
    const next: PlacedObject = { ...previous, lifecycle: 'installed', updatedAt: previous.updatedAt + 1 };

    const result = await runObjectLifecycle(previous, next, deps);

    expect(addNode).toHaveBeenCalledTimes(1);
    // PQS has 2 schedules (visual_inspection monthly + pressure_test annual)
    expect(addCalendarEvent.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.zkNodeSpec).not.toBeNull();
    expect(result.calendarEventSpecs.length).toBeGreaterThanOrEqual(2);
  });

  it('installed -> active emits ZK node but no new calendar events', async () => {
    const { addNode, addCalendarEvent, deps } = makeDeps();
    const previous = makeObject({ lifecycle: 'installed' });
    const next: PlacedObject = { ...previous, lifecycle: 'active', updatedAt: previous.updatedAt + 1 };

    await runObjectLifecycle(previous, next, deps);

    expect(addNode).toHaveBeenCalledTimes(1);
    expect(addCalendarEvent).not.toHaveBeenCalled();
  });

  it('-> retired produces userMessages mentioning cancellation', async () => {
    const { deps } = makeDeps();
    const previous = makeObject({ lifecycle: 'active' });
    const next: PlacedObject = { ...previous, lifecycle: 'retired', updatedAt: previous.updatedAt + 1 };

    const result = await runObjectLifecycle(previous, next, deps);

    expect(result.userMessages.length).toBeGreaterThan(0);
    expect(result.userMessages.join(' ').toLowerCase()).toContain('retirado');
  });

  it('position-only change emits ZK node with no calendar events', async () => {
    const { addNode, addCalendarEvent, deps } = makeDeps();
    const previous = makeObject({ lifecycle: 'installed', position: { x: 1, y: 0, z: 1 } });
    const next: PlacedObject = {
      ...previous,
      position: { x: 2, y: 0, z: 1 },
      updatedAt: previous.updatedAt + 1,
    };

    const result = await runObjectLifecycle(previous, next, deps);

    expect(addNode).toHaveBeenCalledTimes(1);
    expect(addCalendarEvent).not.toHaveBeenCalled();
    expect(result.zkNodeSpec).not.toBeNull();
    expect(result.calendarEventSpecs).toEqual([]);
  });
});
