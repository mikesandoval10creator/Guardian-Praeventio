// @vitest-environment jsdom
/**
 * Bucket OO (Sprint 25) — tests for useHealthMetrics.
 *
 * Mocks @capacitor/core + healthFacadeNative so we can drive the
 * backend selection per-test without needing the native bridge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const isNativeMock = vi.fn(() => false);
const getPlatformMock = vi.fn(() => 'web');

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativeMock(),
    getPlatform: () => getPlatformMock(),
    registerPlugin: () => ({}),
  },
}));

const facadeMock = {
  backend: 'none' as 'none' | 'healthkit' | 'health-connect',
  requestPermissions: vi.fn(async () => ({ granted: [], denied: [] })),
  getStepsToday: vi.fn(async () => 0),
  getHeartRate: vi.fn(async () => [] as { timestamp: number; bpm: number }[]),
  getActiveEnergyBurned: vi.fn(
    async () => [] as { timestamp: number; kcal: number }[],
  ),
  getDistanceWalked: vi.fn(
    async () => [] as { timestamp: number; meters: number }[],
  ),
};

vi.mock('../services/health/healthFacadeNative', () => ({
  getHealthFacadeNative: () => facadeMock,
}));

import { useHealthMetrics } from './useHealthMetrics';

const PERM_KEY = 'gp.health.permissions.granted';

beforeEach(() => {
  isNativeMock.mockReset();
  isNativeMock.mockReturnValue(false);
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue('web');
  facadeMock.backend = 'none';
  facadeMock.requestPermissions.mockReset();
  facadeMock.requestPermissions.mockResolvedValue({
    granted: ['steps', 'heartRate', 'activeEnergy', 'distance'],
    denied: [],
  });
  facadeMock.getStepsToday.mockReset();
  facadeMock.getStepsToday.mockResolvedValue(0);
  facadeMock.getHeartRate.mockReset();
  facadeMock.getHeartRate.mockResolvedValue([]);
  facadeMock.getActiveEnergyBurned.mockReset();
  facadeMock.getActiveEnergyBurned.mockResolvedValue([]);
  facadeMock.getDistanceWalked.mockReset();
  facadeMock.getDistanceWalked.mockResolvedValue([]);
  globalThis.localStorage?.removeItem(PERM_KEY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useHealthMetrics — platform routing', () => {
  it('web platform reports the override source and skips the native facade', async () => {
    isNativeMock.mockReturnValue(false);
    const { result } = renderHook(() =>
      useHealthMetrics({
        autoSyncMs: 0,
        webOverride: {
          stepsToday: 4321,
          heartRateBpm: 88,
          lastSyncMs: 1700000000000,
          source: 'web-bluetooth',
        },
      }),
    );

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.source).toBe('web-bluetooth');
    expect(result.current.stepsToday).toBe(4321);
    expect(result.current.heartRateRecent[0]?.bpm).toBe(88);
    expect(facadeMock.getStepsToday).not.toHaveBeenCalled();
  });

  it('iOS platform calls HealthKit-backed facade after permissions cached', async () => {
    isNativeMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue('ios');
    facadeMock.backend = 'healthkit';
    facadeMock.getStepsToday.mockResolvedValue(7777);
    facadeMock.getHeartRate.mockResolvedValue([
      { timestamp: 1, bpm: 72 },
      { timestamp: 2, bpm: 75 },
    ]);
    facadeMock.getActiveEnergyBurned.mockResolvedValue([
      { timestamp: 1, kcal: 120 },
      { timestamp: 2, kcal: 80 },
    ]);
    facadeMock.getDistanceWalked.mockResolvedValue([
      { timestamp: 1, meters: 1500 },
      { timestamp: 2, meters: 500 },
    ]);

    globalThis.localStorage.setItem(
      PERM_KEY,
      JSON.stringify(['steps', 'heartRate', 'activeEnergy', 'distance']),
    );

    const { result } = renderHook(() =>
      useHealthMetrics({ autoSyncMs: 0 }),
    );

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.source).toBe('healthkit');
    expect(result.current.stepsToday).toBe(7777);
    expect(result.current.heartRateRecent).toHaveLength(2);
    expect(result.current.activeEnergyKcal).toBe(200);
    expect(result.current.distanceM).toBe(2000);
    expect(facadeMock.getStepsToday).toHaveBeenCalled();
  });

  it('Android platform routes through Health Connect backend', async () => {
    isNativeMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue('android');
    facadeMock.backend = 'health-connect';
    facadeMock.getStepsToday.mockResolvedValue(2222);

    globalThis.localStorage.setItem(
      PERM_KEY,
      JSON.stringify(['steps']),
    );

    const { result } = renderHook(() =>
      useHealthMetrics({ autoSyncMs: 0 }),
    );

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.source).toBe('health-connect');
    expect(result.current.stepsToday).toBe(2222);
  });
});

describe('useHealthMetrics — permissions', () => {
  it('requestPermissions caches granted scopes in localStorage', async () => {
    isNativeMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue('android');
    facadeMock.backend = 'health-connect';
    facadeMock.requestPermissions.mockResolvedValueOnce({
      granted: ['steps', 'heartRate'],
      denied: ['activeEnergy', 'distance'],
    });

    const { result } = renderHook(() =>
      useHealthMetrics({ autoSyncMs: 0 }),
    );

    let granted = false;
    await act(async () => {
      granted = await result.current.requestPermissions();
    });

    expect(granted).toBe(true);
    const cached = JSON.parse(
      globalThis.localStorage.getItem(PERM_KEY) ?? '[]',
    );
    expect(cached).toEqual(['steps', 'heartRate']);
  });

  it('permission denied surfaces error state and returns false', async () => {
    isNativeMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue('ios');
    facadeMock.backend = 'healthkit';
    facadeMock.requestPermissions.mockResolvedValueOnce({
      granted: [],
      denied: ['steps', 'heartRate', 'activeEnergy', 'distance'],
    });

    const { result } = renderHook(() =>
      useHealthMetrics({ autoSyncMs: 0 }),
    );

    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestPermissions();
    });

    expect(granted).toBe(false);
    expect(result.current.error).toBe('permissions-denied');
  });

  it('native sync without cached permissions reports permissions-not-granted', async () => {
    isNativeMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue('ios');
    facadeMock.backend = 'healthkit';

    const { result } = renderHook(() =>
      useHealthMetrics({ autoSyncMs: 0 }),
    );

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.error).toBe('permissions-not-granted');
    expect(facadeMock.getStepsToday).not.toHaveBeenCalled();
  });
});

describe('useHealthMetrics — auto-sync', () => {
  it('auto-sync interval triggers syncNow on the configured cadence', async () => {
    isNativeMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue('ios');
    facadeMock.backend = 'healthkit';
    facadeMock.getStepsToday.mockResolvedValue(123);
    globalThis.localStorage.setItem(
      PERM_KEY,
      JSON.stringify(['steps']),
    );

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = renderHook(() =>
      useHealthMetrics({ autoSyncMs: 1234 }),
    );

    // Hook installs the interval at the requested cadence.
    expect(setIntervalSpy).toHaveBeenCalled();
    const lastCall = setIntervalSpy.mock.calls.find(
      (c) => c[1] === 1234,
    );
    expect(lastCall).toBeDefined();
    const tickFn = lastCall![0] as () => void;

    // Manually invoke the tick function and confirm the facade is hit.
    await act(async () => {
      tickFn();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(facadeMock.getStepsToday).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      tickFn();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(facadeMock.getStepsToday).toHaveBeenCalledTimes(2),
    );

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
