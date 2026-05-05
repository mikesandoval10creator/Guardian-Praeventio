/**
 * Sprint 30 Bucket HH — tests for the shift-aware native health adapter.
 *
 * Strategy: the adapter is dependency-injectable, so every test passes a
 * fake `HealthFacadeNative` plus a `shiftProvider` that returns a fixed
 * window. No module mocks are required — keeps the suite portable and
 * the failure-mode signal sharp (no spooky-action-at-a-distance).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createNativeHealthAdapter,
  type HealthScope,
} from './nativeHealthAdapter';
import type {
  ActiveEnergyPoint,
  HealthFacadeNative,
  HealthMetric,
  HealthPermissionResult,
  HeartRatePoint,
} from './healthFacadeNative';
import type { ShiftWindow } from './shiftWindow';

// ---------- Fixtures ---------------------------------------------------------

const NOW = new Date('2026-05-05T14:00:00Z').getTime();
const SHIFT: ShiftWindow = {
  startMs: new Date('2026-05-05T08:00:00Z').getTime(), // 8 AM UTC
  endMs: new Date('2026-05-05T17:00:00Z').getTime(),   // 5 PM UTC
  projectId: 'proj-1',
  workerUid: 'worker-1',
};

function makeFacade(
  overrides: Partial<HealthFacadeNative> = {},
): HealthFacadeNative {
  return {
    backend: 'health-connect',
    requestPermissions: vi.fn(
      async (m: HealthMetric[]): Promise<HealthPermissionResult> => ({
        granted: m,
        denied: [],
      }),
    ),
    getStepsToday: vi.fn(async () => 0),
    getHeartRate: vi.fn(async (): Promise<HeartRatePoint[]> => []),
    getActiveEnergyBurned: vi.fn(async (): Promise<ActiveEnergyPoint[]> => []),
    getDistanceWalked: vi.fn(async () => []),
    ...overrides,
  };
}

const SCOPES: HealthScope[] = ['steps', 'heart_rate', 'active_calories'];

// ---------- Tests ------------------------------------------------------------

describe('createNativeHealthAdapter — init + permissions', () => {
  it('initNativeHealth returns true for native backends (Health Connect)', async () => {
    const adapter = createNativeHealthAdapter({
      facade: makeFacade({ backend: 'health-connect' }),
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.initNativeHealth()).toBe(true);
    expect(adapter.backend).toBe('health-connect');
  });

  it('initNativeHealth returns false on web/none backend', async () => {
    const adapter = createNativeHealthAdapter({
      facade: makeFacade({ backend: 'none' }),
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.initNativeHealth()).toBe(false);
  });

  it('requestPermissions returns true when all scopes granted', async () => {
    const facade = makeFacade();
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.requestPermissions(SCOPES)).toBe(true);
    expect(facade.requestPermissions).toHaveBeenCalledWith(
      expect.arrayContaining(['steps', 'heartRate', 'activeEnergy']),
    );
  });

  it('requestPermissions returns false when OS denies everything', async () => {
    const facade = makeFacade({
      requestPermissions: vi.fn(async () => ({
        granted: [] as HealthMetric[],
        denied: ['steps', 'heartRate', 'activeEnergy'] as HealthMetric[],
      })),
    });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.requestPermissions(SCOPES)).toBe(false);
  });

  it('requestPermissions swallows plugin errors -> false', async () => {
    const facade = makeFacade({
      requestPermissions: vi.fn(async () => {
        throw new Error('plugin-not-installed');
      }),
    });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.requestPermissions(SCOPES)).toBe(false);
  });

  it('requestPermissions with only "sleep" scope -> false (unsupported on this surface)', async () => {
    const facade = makeFacade();
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.requestPermissions(['sleep'])).toBe(false);
    expect(facade.requestPermissions).not.toHaveBeenCalled();
  });
});

describe('getStepsToday — ShiftWindow enforcement (ADR 0010)', () => {
  it('returns the facade total when "now" is inside shift', async () => {
    const facade = makeFacade({ getStepsToday: vi.fn(async () => 4321) });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.getStepsToday()).toBe(4321);
  });

  it('returns null when "now" is outside the shift window', async () => {
    const outOfShift = new Date('2026-05-05T20:00:00Z').getTime(); // 8pm
    const facade = makeFacade({ getStepsToday: vi.fn(async () => 9999) });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => outOfShift,
    });
    expect(await adapter.getStepsToday()).toBeNull();
    // Crucially: the facade must not even be queried for out-of-shift
    // reads — silent-drop must happen BEFORE the OS call.
    expect(facade.getStepsToday).not.toHaveBeenCalled();
  });

  it('returns null when no shift is active', async () => {
    const facade = makeFacade({ getStepsToday: vi.fn(async () => 5000) });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => null,
      now: () => NOW,
    });
    expect(await adapter.getStepsToday()).toBeNull();
    expect(facade.getStepsToday).not.toHaveBeenCalled();
  });

  it('returns null on web/none backend', async () => {
    const facade = makeFacade({ backend: 'none' });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.getStepsToday()).toBeNull();
  });
});

describe('getHeartRateLatest — sample-level shift filtering', () => {
  it('drops samples timestamped outside the shift window', async () => {
    const insideTs = NOW - 60_000; // 1 min ago, in shift
    const outsideTs = SHIFT.startMs - 60_000; // 1 min before clock-in
    const facade = makeFacade({
      getHeartRate: vi.fn(async () => [
        { timestamp: outsideTs, bpm: 999 }, // sneaky pre-shift sample
        { timestamp: insideTs, bpm: 78 },
      ]),
    });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    const latest = await adapter.getHeartRateLatest();
    expect(latest).toEqual({ timestamp: insideTs, bpm: 78 });
  });

  it('returns null when every sample is outside the shift', async () => {
    const facade = makeFacade({
      getHeartRate: vi.fn(async () => [
        { timestamp: SHIFT.startMs - 1000, bpm: 70 },
        { timestamp: SHIFT.endMs + 1000, bpm: 75 },
      ]),
    });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.getHeartRateLatest()).toBeNull();
  });

  it('returns null on platform === "web" (none backend)', async () => {
    const facade = makeFacade({ backend: 'none' });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.getHeartRateLatest()).toBeNull();
  });

  it('swallows plugin throw -> null', async () => {
    const facade = makeFacade({
      getHeartRate: vi.fn(async () => {
        throw new Error('plugin not installed');
      }),
    });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.getHeartRateLatest()).toBeNull();
  });

  it('picks the freshest in-shift sample even if facade returns out of order', async () => {
    const t1 = NOW - 240_000;
    const t2 = NOW - 30_000;
    const t3 = NOW - 90_000;
    const facade = makeFacade({
      getHeartRate: vi.fn(async () => [
        { timestamp: t1, bpm: 60 },
        { timestamp: t2, bpm: 88 },
        { timestamp: t3, bpm: 72 },
      ]),
    });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.getHeartRateLatest()).toEqual({
      timestamp: t2,
      bpm: 88,
    });
  });
});

describe('getActiveCaloriesToday — clamps query to shift', () => {
  it('sums only in-shift samples', async () => {
    const facade = makeFacade({
      getActiveEnergyBurned: vi.fn(async () => [
        { timestamp: SHIFT.startMs - 10_000, kcal: 999 }, // pre-shift
        { timestamp: SHIFT.startMs + 60_000, kcal: 50 },
        { timestamp: NOW - 60_000, kcal: 30 },
      ]),
    });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(await adapter.getActiveCaloriesToday()).toBe(80);
  });

  it('returns null with no shift', async () => {
    const facade = makeFacade();
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => null,
      now: () => NOW,
    });
    expect(await adapter.getActiveCaloriesToday()).toBeNull();
    expect(facade.getActiveEnergyBurned).not.toHaveBeenCalled();
  });
});

describe('cross-platform routing', () => {
  it('honors backend "healthkit" passed by the facade (iOS)', async () => {
    const facade = makeFacade({ backend: 'healthkit' });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(adapter.backend).toBe('healthkit');
    expect(await adapter.initNativeHealth()).toBe(true);
  });

  it('honors backend "health-connect" (Android)', async () => {
    const facade = makeFacade({ backend: 'health-connect' });
    const adapter = createNativeHealthAdapter({
      facade,
      shiftProvider: () => SHIFT,
      now: () => NOW,
    });
    expect(adapter.backend).toBe('health-connect');
  });
});
