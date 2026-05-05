/**
 * Bucket P (Sprint 21 ola 5) — tests for the native health facade.
 *
 * Strategy:
 *   - vi.mock `@capacitor/core` so we can flip platform per-test.
 *   - vi.mock both plugin packages so we can assert what gets called and
 *     stub return shapes without needing the native Capacitor bridge.
 *   - Use `__setNativePlatformChecker` (the public test seam in
 *     `healthFacadeNative.ts`) to drive the facade selection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    registerPlugin: () => ({}),
  },
}));

const hkRequestAuth = vi.fn();
const hkQuery = vi.fn();
vi.mock('@perfood/capacitor-healthkit', () => ({
  CapacitorHealthkit: {
    requestAuthorization: (...args: unknown[]) => hkRequestAuth(...args),
    queryHKitSampleType: (...args: unknown[]) => hkQuery(...args),
    isAvailable: vi.fn(),
    multipleQueryHKitSampleType: vi.fn(),
    isEditionAuthorized: vi.fn(),
    multipleIsEditionAuthorized: vi.fn(),
  },
  SampleNames: {
    HEART_RATE: 'heartRate',
    STEP_COUNT: 'stepCount',
    ACTIVE_ENERGY_BURNED: 'activeEnergyBurned',
    SLEEP_ANALYSIS: 'sleepAnalysis',
  },
}));

const hcRequestPerms = vi.fn();
const hcRead = vi.fn();
vi.mock('@kiwi-health/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: vi.fn(async () => ({ availability: 'Available' })),
    requestHealthPermissions: (...args: unknown[]) => hcRequestPerms(...args),
    readRecords: (...args: unknown[]) => hcRead(...args),
    readRecord: vi.fn(),
    insertRecords: vi.fn(),
    revokeHealthPermissions: vi.fn(),
    openHealthConnectSetting: vi.fn(),
    getChangesToken: vi.fn(),
    getChanges: vi.fn(),
    checkHealthPermissions: vi.fn(),
  },
}));

import {
  __setNativePlatformChecker,
  getHealthFacadeNative,
  type HealthMetric,
} from './healthFacadeNative';

beforeEach(() => {
  hkRequestAuth.mockReset();
  hkQuery.mockReset();
  hcRequestPerms.mockReset();
  hcRead.mockReset();
});

afterEach(() => {
  __setNativePlatformChecker(null);
});

describe('getHealthFacadeNative — backend selection', () => {
  it('returns noop backend on web', async () => {
    __setNativePlatformChecker(() => ({ isNative: false, platform: 'web' }));
    const facade = getHealthFacadeNative();
    expect(facade.backend).toBe('none');
    // Read methods must resolve to safe empty defaults, never throw.
    await expect(facade.getStepsToday()).resolves.toBe(0);
    await expect(
      facade.getHeartRate(new Date(0), new Date(1)),
    ).resolves.toEqual([]);
    await expect(
      facade.getDistanceWalked(new Date(0), new Date(1)),
    ).resolves.toEqual([]);
    expect(hkQuery).not.toHaveBeenCalled();
    expect(hcRead).not.toHaveBeenCalled();
  });

  it('returns healthkit backend on native iOS and routes reads to the HK plugin', async () => {
    __setNativePlatformChecker(() => ({ isNative: true, platform: 'ios' }));
    hkQuery.mockResolvedValue({
      countReturn: 2,
      resultData: [
        { startDate: '2026-05-04T08:00:00Z', value: 1200 },
        { startDate: '2026-05-04T09:00:00Z', value: 800 },
      ],
    });

    const facade = getHealthFacadeNative();
    expect(facade.backend).toBe('healthkit');

    const steps = await facade.getStepsToday();
    expect(steps).toBe(2000);
    expect(hkQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sampleName: 'stepCount' }),
    );
  });

  it('returns health-connect backend on native Android and routes reads to the HC plugin', async () => {
    __setNativePlatformChecker(() => ({ isNative: true, platform: 'android' }));
    hcRead.mockResolvedValue({
      records: [
        { type: 'Steps', count: 4321, startTime: new Date('2026-05-04T07:00:00Z') },
        { type: 'Steps', count: 100, startTime: new Date('2026-05-04T08:00:00Z') },
      ],
    });

    const facade = getHealthFacadeNative();
    expect(facade.backend).toBe('health-connect');

    const steps = await facade.getStepsToday();
    expect(steps).toBe(4421);
    expect(hcRead).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Steps' }),
    );
    expect(hkQuery).not.toHaveBeenCalled();
  });
});

describe('iOS HealthKit — permission + reads', () => {
  beforeEach(() => {
    __setNativePlatformChecker(() => ({ isNative: true, platform: 'ios' }));
  });

  it('requestPermissions reports all metrics granted on success (Apple privacy model)', async () => {
    hkRequestAuth.mockResolvedValue(undefined);
    const facade = getHealthFacadeNative();
    const metrics: HealthMetric[] = [
      'steps',
      'heartRate',
      'activeEnergy',
      'distance',
    ];
    const result = await facade.requestPermissions(metrics);
    expect(result.granted).toEqual(metrics);
    expect(result.denied).toEqual([]);

    // The HK request must include all four sample-type strings.
    expect(hkRequestAuth).toHaveBeenCalledTimes(1);
    const callArg = hkRequestAuth.mock.calls[0]?.[0] as { read: string[] };
    expect(callArg.read).toEqual(
      expect.arrayContaining([
        'stepCount',
        'heartRate',
        'activeEnergyBurned',
        'distanceWalkingRunning',
      ]),
    );
  });

  it('requestPermissions returns all-denied when the HK plugin rejects', async () => {
    hkRequestAuth.mockRejectedValue(new Error('user denied'));
    const facade = getHealthFacadeNative();
    const metrics: HealthMetric[] = ['steps', 'heartRate'];
    const result = await facade.requestPermissions(metrics);
    expect(result.granted).toEqual([]);
    expect(result.denied).toEqual(metrics);
  });

  it('getHeartRate returns rounded bpm samples in plugin response order', async () => {
    hkQuery.mockResolvedValue({
      countReturn: 2,
      resultData: [
        { startDate: '2026-05-04T08:00:00Z', value: 72.4 },
        { startDate: '2026-05-04T08:01:00Z', value: 75.6 },
      ],
    });
    const facade = getHealthFacadeNative();
    const points = await facade.getHeartRate(
      new Date('2026-05-04T07:00:00Z'),
      new Date('2026-05-04T09:00:00Z'),
    );
    expect(points).toHaveLength(2);
    expect(points[0].bpm).toBe(72);
    expect(points[1].bpm).toBe(76);
    expect(points[0].timestamp).toBe(
      new Date('2026-05-04T08:00:00Z').getTime(),
    );
  });

  it('returns [] / 0 when the HK plugin throws (denied permission or missing data)', async () => {
    hkQuery.mockRejectedValue(new Error('not authorized'));
    const facade = getHealthFacadeNative();
    await expect(facade.getStepsToday()).resolves.toBe(0);
    await expect(
      facade.getHeartRate(new Date(0), new Date(1)),
    ).resolves.toEqual([]);
    await expect(
      facade.getActiveEnergyBurned(new Date(0), new Date(1)),
    ).resolves.toEqual([]);
    await expect(
      facade.getDistanceWalked(new Date(0), new Date(1)),
    ).resolves.toEqual([]);
  });

  it('getActiveEnergyBurned and getDistanceWalked map plugin output to typed points', async () => {
    hkQuery.mockResolvedValueOnce({
      countReturn: 1,
      resultData: [
        { startDate: '2026-05-04T10:00:00Z', value: 42.5 },
      ],
    });
    hkQuery.mockResolvedValueOnce({
      countReturn: 1,
      resultData: [
        { startDate: '2026-05-04T10:00:00Z', value: 1234 },
      ],
    });
    const facade = getHealthFacadeNative();
    const range = [new Date('2026-05-04T00:00:00Z'), new Date('2026-05-04T23:59:59Z')] as const;

    const energy = await facade.getActiveEnergyBurned(range[0], range[1]);
    expect(energy).toEqual([
      {
        timestamp: new Date('2026-05-04T10:00:00Z').getTime(),
        kcal: 42.5,
      },
    ]);

    const distance = await facade.getDistanceWalked(range[0], range[1]);
    expect(distance).toEqual([
      {
        timestamp: new Date('2026-05-04T10:00:00Z').getTime(),
        meters: 1234,
      },
    ]);
  });
});

describe('Android Health Connect — permission + reads', () => {
  beforeEach(() => {
    __setNativePlatformChecker(() => ({ isNative: true, platform: 'android' }));
  });

  it('requestPermissions reflects the plugin grantedPermissions back to metric names', async () => {
    hcRequestPerms.mockResolvedValue({
      grantedPermissions: [
        'android.permission.health.READ_STEPS',
        'android.permission.health.READ_HEART_RATE',
      ],
      hasAllPermissions: false,
    });
    const facade = getHealthFacadeNative();
    const result = await facade.requestPermissions([
      'steps',
      'heartRate',
      'activeEnergy',
    ]);
    expect(result.granted).toEqual(['steps', 'heartRate']);
    expect(result.denied).toEqual(['activeEnergy']);
  });

  it('getHeartRate flattens HeartRateSeries records into per-sample points', async () => {
    hcRead.mockResolvedValue({
      records: [
        {
          type: 'HeartRateSeries',
          samples: [
            { time: new Date('2026-05-04T08:00:00Z'), beatsPerMinute: 70.7 },
            { time: new Date('2026-05-04T08:01:00Z'), beatsPerMinute: 71.2 },
          ],
        },
      ],
    });
    const facade = getHealthFacadeNative();
    const points = await facade.getHeartRate(
      new Date('2026-05-04T07:00:00Z'),
      new Date('2026-05-04T09:00:00Z'),
    );
    expect(points).toEqual([
      {
        timestamp: new Date('2026-05-04T08:00:00Z').getTime(),
        bpm: 71,
      },
      {
        timestamp: new Date('2026-05-04T08:01:00Z').getTime(),
        bpm: 71,
      },
    ]);
  });

  it('returns [] / 0 when the HC plugin throws', async () => {
    hcRead.mockRejectedValue(new Error('plugin not available'));
    const facade = getHealthFacadeNative();
    await expect(facade.getStepsToday()).resolves.toBe(0);
    await expect(
      facade.getHeartRate(new Date(0), new Date(1)),
    ).resolves.toEqual([]);
    await expect(
      facade.getActiveEnergyBurned(new Date(0), new Date(1)),
    ).resolves.toEqual([]);
    await expect(
      facade.getDistanceWalked(new Date(0), new Date(1)),
    ).resolves.toEqual([]);
  });
});
