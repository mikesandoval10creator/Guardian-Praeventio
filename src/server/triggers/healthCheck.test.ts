// Praeventio Guard — Round 21 B1 Phase 5 tests.
//
// Coverage matrix for `setupHealthCheckInterval`:
//   • Returns a stop() handle
//   • Defaults to 6h interval
//   • Honors a custom intervalMs
//   • stop() clears the timer (no further ticks)
//   • Each tick fetches projects and calls performCheck per project
//   • An error in one project does NOT abort the loop or other projects

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupHealthCheckInterval,
  DEFAULT_HEALTH_CHECK_INTERVAL_MS,
} from './healthCheck.js';

function makeFakeDb(projectIds: string[]) {
  return {
    collection: vi.fn(() => ({
      get: vi.fn(() =>
        Promise.resolve({
          docs: projectIds.map((id) => ({ id })),
        }),
      ),
    })),
  } as any;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('setupHealthCheckInterval', () => {
  it('exports the default 6h cadence constant', () => {
    expect(DEFAULT_HEALTH_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('returns a stop() handle', () => {
    const handle = setupHealthCheckInterval({
      db: makeFakeDb([]),
      performProjectSafetyHealthCheck: async () => {},
    });
    expect(typeof handle.stop).toBe('function');
    handle.stop();
  });

  it('does not fire on registration — only on the first tick', () => {
    const performCheck = vi.fn(async (_id: string) => {});
    setupHealthCheckInterval({
      db: makeFakeDb(['p1']),
      intervalMs: 1000,
      performProjectSafetyHealthCheck: performCheck,
    });
    expect(performCheck).not.toHaveBeenCalled();
  });

  it('runs performCheck for each project on every tick (custom interval)', async () => {
    const performCheck = vi.fn(async (_id: string) => {});
    setupHealthCheckInterval({
      db: makeFakeDb(['p1', 'p2', 'p3']),
      intervalMs: 1000,
      performProjectSafetyHealthCheck: performCheck,
    });

    await vi.advanceTimersByTimeAsync(1000);
    // tick complete: 3 projects checked
    expect(performCheck).toHaveBeenCalledTimes(3);
    expect(performCheck.mock.calls.map((c) => c[0]).sort()).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('stop() prevents further ticks', async () => {
    const performCheck = vi.fn(async (_id: string) => {});
    const handle = setupHealthCheckInterval({
      db: makeFakeDb(['p1']),
      intervalMs: 1000,
      performProjectSafetyHealthCheck: performCheck,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick 1
    expect(performCheck).toHaveBeenCalledTimes(1);

    handle.stop();
    await vi.advanceTimersByTimeAsync(5000); // would have been 5 more ticks
    expect(performCheck).toHaveBeenCalledTimes(1);
  });

  it('continues across projects when one performCheck rejects', async () => {
    const performCheck = vi.fn(async (id: string) => {
      if (id === 'p2') throw new Error('boom');
    });
    setupHealthCheckInterval({
      db: makeFakeDb(['p1', 'p2', 'p3']),
      intervalMs: 1000,
      performProjectSafetyHealthCheck: performCheck,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(performCheck).toHaveBeenCalledTimes(3);
  });

  it('catches an error from db.collection().get() without killing the timer', async () => {
    const performCheck = vi.fn(async (_id: string) => {});
    const db = {
      collection: vi.fn(() => ({
        get: vi.fn(() => Promise.reject(new Error('firestore down'))),
      })),
    } as any;
    setupHealthCheckInterval({
      db,
      intervalMs: 1000,
      performProjectSafetyHealthCheck: performCheck,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(performCheck).not.toHaveBeenCalled();

    // Timer must survive — second tick still runs, db rejects again, no throw
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.collection).toHaveBeenCalledTimes(2);
  });
});
