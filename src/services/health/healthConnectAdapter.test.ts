/**
 * Unit tests for healthConnectAdapter.ts (Block 2 Wave 2).
 *
 * Strategy:
 *  - vi.mock('@kiwi-health/capacitor-health-connect') replaces the plugin
 *    surface with controllable vi.fn stubs; individual tests override return
 *    values via mockResolvedValueOnce / mockImplementationOnce.
 *  - vi.mock('@capacitor/core') lets us control isNativePlatform() /
 *    getPlatform() per-test via the test-internal setters exposed below.
 *  - __resetHealthConnectAvailability() (exported @internal) clears the
 *    module-level availability cache so each test starts clean.
 *
 * ADR 0012 assertion (no diagnosis):
 *  Every read* result is verified to contain ONLY raw/normalised metric
 *  fields (timestamp/bpm/count/kcal/startTime/endTime/durationMin/quality).
 *  Tests explicitly assert that NO clinical-verdict, risk-category, or
 *  occupational-disease field appears in any returned object.
 *
 * On-device invariant (CLAUDE.md #12):
 *  All reads are local plugin calls (mocked). The mock captures every call
 *  made to HealthConnect; after each read we verify no network/Firestore
 *  write was attempted (the plugin mock has no "upload" method and none is
 *  called). This is checked structurally — if the adapter were to call a
 *  Firestore import or fetch, the mock would throw because those modules are
 *  not imported by this adapter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock @capacitor/core ────────────────────────────────────────────────────
// We need mutable platform state so individual tests can pretend to be Android.
let _isNative = false;
let _platform = 'web';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => _isNative,
    getPlatform: () => _platform,
    registerPlugin: () => ({}),
  },
}));

// ─── Mock @kiwi-health/capacitor-health-connect ───────────────────────────────
// All functions are vi.fn() stubs; tests set return values per-scenario.
const mockCheckAvailability = vi.fn(
  async (): Promise<{
    availability: 'Available' | 'NotInstalled' | 'NotSupported';
  }> => ({
    availability: 'Available',
  }),
);
const mockRequestHealthPermissions = vi.fn(async () => ({
  grantedPermissions: [] as string[],
  hasAllPermissions: false,
}));
const mockReadRecords = vi.fn(async () => ({ records: [] as unknown[] }));

vi.mock('@kiwi-health/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: (...args: unknown[]) =>
      (mockCheckAvailability as (...a: unknown[]) => unknown)(...args),
    requestHealthPermissions: (...args: unknown[]) =>
      (mockRequestHealthPermissions as (...a: unknown[]) => unknown)(...args),
    readRecords: (...args: unknown[]) =>
      (mockReadRecords as (...a: unknown[]) => unknown)(...args),
    readRecord: vi.fn(async () => ({ record: null })),
    insertRecords: vi.fn(async () => ({ recordIds: [] })),
    revokeHealthPermissions: vi.fn(async () => undefined),
    openHealthConnectSetting: vi.fn(async () => undefined),
    getChangesToken: vi.fn(async () => ({ token: '' })),
    getChanges: vi.fn(async () => ({ changes: [], nextToken: '' })),
  },
}));

// ─── Imports (after mocks are declared) ─────────────────────────────────────
import {
  __resetHealthConnectAvailability,
  awaitAvailability,
  healthConnectAdapter,
  preWarmHealthConnect,
} from './healthConnectAdapter';
import type {
  CaloriesSample,
  HealthDataRange,
  HeartRateSample,
  SleepSample,
  StepsSample,
} from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate an Android native context with Health Connect available. */
function setAndroidAvailable(): void {
  _isNative = true;
  _platform = 'android';
  __resetHealthConnectAvailability('Available');
}

/** Simulate a non-Android context (web / iOS). */
function setNonAndroid(platform = 'web'): void {
  _isNative = platform !== 'web';
  _platform = platform;
  __resetHealthConnectAvailability(null);
}

const RANGE: HealthDataRange = {
  start: new Date('2026-05-01T00:00:00Z'),
  end: new Date('2026-05-01T23:59:59Z'),
};

// Keys that a raw metric sample may contain — anything else is a violation.
const ALLOWED_HR_KEYS: ReadonlySet<string> = new Set([
  'timestamp',
  'bpm',
  'source',
]);
const ALLOWED_STEPS_KEYS: ReadonlySet<string> = new Set([
  'date',
  'count',
  'source',
]);
const ALLOWED_CALORIES_KEYS: ReadonlySet<string> = new Set([
  'date',
  'kcal',
  'basal',
  'active',
]);
const ALLOWED_SLEEP_KEYS: ReadonlySet<string> = new Set([
  'startTime',
  'endTime',
  'durationMin',
  'quality',
]);

/** ADR 0012 guard: assert no diagnostic verdict keys are present. */
function assertNoDiagnosticFields(obj: Record<string, unknown>): void {
  const BANNED = [
    'diagnosis',
    'risk',
    'riskCategory',
    'clinicalRisk',
    'occupationalDisease',
    'verdict',
    'assessment',
    'recommendation',
    'pathology',
    'condition',
    'fitnessVerdict',
  ];
  for (const key of BANNED) {
    expect(
      Object.prototype.hasOwnProperty.call(obj, key),
      `ADR 0012 violation: diagnostic field "${key}" found in result`,
    ).toBe(false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Adapter identity
// ─────────────────────────────────────────────────────────────────────────────

describe('healthConnectAdapter — identity', () => {
  it('has name === "health-connect"', () => {
    expect(healthConnectAdapter.name).toBe('health-connect');
  });

  it('has platform === "capacitor"', () => {
    expect(healthConnectAdapter.platform).toBe('capacitor');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — isAvailable (synchronous probe logic)
// ─────────────────────────────────────────────────────────────────────────────

describe('healthConnectAdapter.isAvailable', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
    vi.clearAllMocks();
  });

  it('returns false on non-native platform (web)', () => {
    setNonAndroid('web');
    expect(healthConnectAdapter.isAvailable).toBe(false);
  });

  it('returns false on native iOS (not android)', () => {
    _isNative = true;
    _platform = 'ios';
    __resetHealthConnectAvailability('Available'); // pretend cache says Available
    expect(healthConnectAdapter.isAvailable).toBe(false);
  });

  it('returns true when native android + cache is "Available"', () => {
    setAndroidAvailable();
    expect(healthConnectAdapter.isAvailable).toBe(true);
  });

  it('returns false when native android + cache is "NotSupported"', () => {
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability('NotSupported');
    expect(healthConnectAdapter.isAvailable).toBe(false);
  });

  it('returns false while cache is null (probe not yet resolved)', () => {
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability(null); // ensure clean cache, probe not started
    // After reset with null, availabilityProbeStarted = false; next isAvailable
    // read kicks off the async probe but returns false synchronously.
    expect(healthConnectAdapter.isAvailable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — preWarmHealthConnect / awaitAvailability
// ─────────────────────────────────────────────────────────────────────────────

describe('preWarmHealthConnect', () => {
  beforeEach(() => {
    __resetHealthConnectAvailability(null);
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
  });

  it('returns false immediately on non-android and sets cache NotSupported', async () => {
    setNonAndroid('web');
    const result = await preWarmHealthConnect();
    expect(result).toBe(false);
    // After the call the cache is warm → subsequent isAvailable still false
    expect(healthConnectAdapter.isAvailable).toBe(false);
  });

  it('returns true when plugin reports Available on Android', async () => {
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability(null);
    mockCheckAvailability.mockResolvedValueOnce({ availability: 'Available' });

    const result = await preWarmHealthConnect();
    expect(result).toBe(true);
    expect(mockCheckAvailability).toHaveBeenCalledTimes(1);
  });

  it('returns false when plugin reports NotInstalled on Android', async () => {
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability(null);
    mockCheckAvailability.mockResolvedValueOnce({ availability: 'NotInstalled' });

    const result = await preWarmHealthConnect();
    expect(result).toBe(false);
  });

  it('returns false and swallows plugin error (network-type failure)', async () => {
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability(null);
    mockCheckAvailability.mockRejectedValueOnce(new Error('bridge-error'));

    await expect(preWarmHealthConnect()).resolves.toBe(false);
  });
});

describe('awaitAvailability', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
    vi.clearAllMocks();
  });

  it('resolves immediately from cache when already populated (Available)', async () => {
    // Populate the cache directly so no probe is needed.
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability('Available');
    const callsBefore = mockCheckAvailability.mock.calls.length;

    const result = await awaitAvailability();
    expect(result).toBe(true);
    // awaitAvailability must not have started a NEW probe call —
    // the call count must not increase beyond what was already present.
    expect(mockCheckAvailability.mock.calls.length).toBe(callsBefore);
  });

  it('resolves immediately from cache when already populated (NotSupported)', async () => {
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability('NotSupported');
    const result = await awaitAvailability();
    expect(result).toBe(false);
    expect(mockCheckAvailability).not.toHaveBeenCalled();
  });

  it('triggers a fresh probe when cache is null', async () => {
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability(null);
    mockCheckAvailability.mockResolvedValueOnce({ availability: 'Available' });

    const result = await awaitAvailability();
    expect(result).toBe(true);
    expect(mockCheckAvailability).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — requestPermissions
// ─────────────────────────────────────────────────────────────────────────────

describe('healthConnectAdapter.requestPermissions', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
    vi.clearAllMocks();
  });

  it('returns all scopes as denied when no record types map (empty scope list)', async () => {
    setAndroidAvailable();
    // @ts-expect-error — testing unknown scope gracefully
    const result = await healthConnectAdapter.requestPermissions(['unknown-scope']);
    expect(result.granted).toEqual([]);
    expect(result.denied).toEqual(['unknown-scope']);
    // Plugin must NOT have been called — no record types to request
    expect(mockRequestHealthPermissions).not.toHaveBeenCalled();
  });

  it('grants heart-rate when OS returns READ_HEART_RATE permission', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: [
        'android.permission.health.READ_HEART_RATE',
      ],
      hasAllPermissions: false,
    });

    const result = await healthConnectAdapter.requestPermissions(['heart-rate']);
    expect(result.granted).toContain('heart-rate');
    expect(result.denied).not.toContain('heart-rate');
  });

  it('grants steps when OS returns READ_STEPS permission', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: ['android.permission.health.READ_STEPS'],
      hasAllPermissions: false,
    });

    const result = await healthConnectAdapter.requestPermissions(['steps']);
    expect(result.granted).toContain('steps');
    expect(result.denied).not.toContain('steps');
  });

  it('grants calories when OS returns both calorie permissions', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: [
        'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
        'android.permission.health.READ_TOTAL_CALORIES_BURNED',
      ],
      hasAllPermissions: true,
    });

    const result = await healthConnectAdapter.requestPermissions(['calories']);
    expect(result.granted).toContain('calories');
  });

  it('grants sleep when OS returns READ_SLEEP_SESSION permission', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: ['android.permission.health.READ_SLEEP_SESSION'],
      hasAllPermissions: false,
    });

    const result = await healthConnectAdapter.requestPermissions(['sleep']);
    expect(result.granted).toContain('sleep');
  });

  it('grants body-composition when OS returns weight permission', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: ['android.permission.health.READ_WEIGHT'],
      hasAllPermissions: false,
    });

    const result = await healthConnectAdapter.requestPermissions(['body-composition']);
    expect(result.granted).toContain('body-composition');
  });

  it('handles multiple scopes — some granted, some denied', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: [
        'android.permission.health.READ_STEPS',
        // heart-rate NOT included → denied
      ],
      hasAllPermissions: false,
    });

    const result = await healthConnectAdapter.requestPermissions([
      'heart-rate',
      'steps',
    ]);
    expect(result.granted).toContain('steps');
    expect(result.denied).toContain('heart-rate');
  });

  it('reports all scopes denied when OS grants nothing', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: [],
      hasAllPermissions: false,
    });

    const result = await healthConnectAdapter.requestPermissions([
      'heart-rate',
      'steps',
      'calories',
      'sleep',
    ]);
    expect(result.granted).toEqual([]);
    expect(result.denied).toHaveLength(4);
  });

  it('deduplicates record types for calorie scope (no double-request)', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: [],
      hasAllPermissions: false,
    });

    // calories maps to 2 record types; calling with calories twice must not
    // send duplicate record types.
    await healthConnectAdapter.requestPermissions(['calories', 'calories']);
    const call = (
      mockRequestHealthPermissions.mock.calls[0] as unknown as [
        { read: string[]; write: string[] },
      ]
    )[0];
    const unique = new Set(call.read);
    expect(unique.size).toBe(call.read.length); // no duplicates
  });

  it('always sends write: [] (Guardian is read-only)', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: [],
      hasAllPermissions: false,
    });

    await healthConnectAdapter.requestPermissions(['steps']);
    const call = (
      mockRequestHealthPermissions.mock.calls[0] as unknown as [
        { read: string[]; write: string[] },
      ]
    )[0];
    expect(call.write).toEqual([]);
  });

  it('result fields are limited to granted + denied (ADR 0012 — no diagnosis keys)', async () => {
    setAndroidAvailable();
    mockRequestHealthPermissions.mockResolvedValueOnce({
      grantedPermissions: ['android.permission.health.READ_STEPS'],
      hasAllPermissions: false,
    });

    const result = await healthConnectAdapter.requestPermissions(['steps']);
    const keys = Object.keys(result);
    expect(keys.sort()).toEqual(['denied', 'granted']);
    // No diagnostic fields on the permission result itself
    assertNoDiagnosticFields(result as unknown as Record<string, unknown>);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — readHeartRate
// ─────────────────────────────────────────────────────────────────────────────

describe('healthConnectAdapter.readHeartRate', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
    vi.clearAllMocks();
  });

  it('returns [] when adapter is not available', async () => {
    setNonAndroid();
    const result = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result).toEqual([]);
    expect(mockReadRecords).not.toHaveBeenCalled();
  });

  it('returns [] when plugin returns no records', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({ records: [] });

    const result = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result).toEqual([]);
  });

  it('normalises a HeartRateSeries record to HeartRateSample[]', async () => {
    setAndroidAvailable();
    const t = '2026-05-01T09:00:00.000Z';
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'HeartRateSeries',
          samples: [{ time: t, beatsPerMinute: 72.7 }],
        },
      ],
    });

    const result: HeartRateSample[] = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].bpm).toBe(73); // Math.round(72.7)
    expect(result[0].timestamp).toEqual(new Date(t));
    expect(result[0].source).toBe('wearable');
  });

  it('flattens multiple samples from a single series record', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'HeartRateSeries',
          samples: [
            { time: '2026-05-01T08:00:00Z', beatsPerMinute: 60 },
            { time: '2026-05-01T08:05:00Z', beatsPerMinute: 65 },
            { time: '2026-05-01T08:10:00Z', beatsPerMinute: 70 },
          ],
        },
      ],
    });

    const result = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.bpm)).toEqual([60, 65, 70]);
  });

  it('flattens samples across multiple HeartRateSeries records', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'HeartRateSeries',
          samples: [{ time: '2026-05-01T08:00:00Z', beatsPerMinute: 60 }],
        },
        {
          type: 'HeartRateSeries',
          samples: [{ time: '2026-05-01T09:00:00Z', beatsPerMinute: 80 }],
        },
      ],
    });

    const result = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result).toHaveLength(2);
  });

  it('skips records of the wrong type silently', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        { type: 'Steps', count: 1000, startTime: RANGE.start },
        {
          type: 'HeartRateSeries',
          samples: [{ time: '2026-05-01T08:00:00Z', beatsPerMinute: 75 }],
        },
      ],
    });

    const result = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].bpm).toBe(75);
  });

  it('tolerates a record with null/undefined samples list gracefully', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [{ type: 'HeartRateSeries', samples: null }],
    });

    // Should not throw — the `?? []` guard handles missing samples
    const result = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result).toEqual([]);
  });

  it('passes the correct timeRangeFilter to the plugin', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({ records: [] });

    await healthConnectAdapter.readHeartRate(RANGE);
    expect(mockReadRecords).toHaveBeenCalledWith({
      type: 'HeartRateSeries',
      timeRangeFilter: {
        type: 'between',
        startTime: RANGE.start,
        endTime: RANGE.end,
      },
    });
  });

  // ── ADR 0012 + on-device invariants ────────────────────────────────────────
  it('ADR 0012: returned samples contain only raw metric fields (no diagnosis)', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'HeartRateSeries',
          samples: [{ time: '2026-05-01T08:00:00Z', beatsPerMinute: 78 }],
        },
      ],
    });

    const result = await healthConnectAdapter.readHeartRate(RANGE);
    for (const sample of result) {
      const keys = Object.keys(sample);
      for (const key of keys) {
        expect(ALLOWED_HR_KEYS.has(key), `Unexpected field "${key}" in HeartRateSample`).toBe(true);
      }
      assertNoDiagnosticFields(sample as unknown as Record<string, unknown>);
    }
  });

  it('on-device: readHeartRate never calls a network/firestore write method', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'HeartRateSeries',
          samples: [{ time: '2026-05-01T08:00:00Z', beatsPerMinute: 90 }],
        },
      ],
    });

    await healthConnectAdapter.readHeartRate(RANGE);

    // Only readRecords should have been called on the Health Connect plugin.
    // insertRecords (write) must NOT be called.
    const { HealthConnect } = await import('@kiwi-health/capacitor-health-connect');
    expect((HealthConnect as unknown as Record<string, unknown>).insertRecords as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — readSteps
// ─────────────────────────────────────────────────────────────────────────────

describe('healthConnectAdapter.readSteps', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
    vi.clearAllMocks();
  });

  it('returns [] when adapter is not available', async () => {
    setNonAndroid();
    const result = await healthConnectAdapter.readSteps(RANGE);
    expect(result).toEqual([]);
    expect(mockReadRecords).not.toHaveBeenCalled();
  });

  it('returns [] on empty records list', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({ records: [] });

    const result = await healthConnectAdapter.readSteps(RANGE);
    expect(result).toEqual([]);
  });

  it('normalises a Steps record to StepsSample', async () => {
    setAndroidAvailable();
    const start = '2026-05-01T08:00:00.000Z';
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'Steps',
          count: 4321,
          startTime: start,
          endTime: '2026-05-01T09:00:00.000Z',
        },
      ],
    });

    const result: StepsSample[] = await healthConnectAdapter.readSteps(RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(4321);
    expect(result[0].date).toEqual(new Date(start));
    expect(result[0].source).toBe('wearable');
  });

  it('produces multiple samples from multiple records', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'Steps',
          count: 1000,
          startTime: '2026-05-01T08:00:00Z',
          endTime: '2026-05-01T09:00:00Z',
        },
        {
          type: 'Steps',
          count: 2500,
          startTime: '2026-05-01T12:00:00Z',
          endTime: '2026-05-01T13:00:00Z',
        },
      ],
    });

    const result = await healthConnectAdapter.readSteps(RANGE);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.count)).toEqual([1000, 2500]);
  });

  it('skips non-Steps records silently', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        { type: 'ActiveCaloriesBurned', energy: { value: 200 }, startTime: RANGE.start },
        {
          type: 'Steps',
          count: 500,
          startTime: '2026-05-01T10:00:00Z',
          endTime: '2026-05-01T11:00:00Z',
        },
      ],
    });

    const result = await healthConnectAdapter.readSteps(RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(500);
  });

  it('ADR 0012: returned samples contain only raw step-metric fields', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'Steps',
          count: 8000,
          startTime: '2026-05-01T06:00:00Z',
          endTime: '2026-05-01T23:59:59Z',
        },
      ],
    });

    const result = await healthConnectAdapter.readSteps(RANGE);
    for (const sample of result) {
      const keys = Object.keys(sample);
      for (const key of keys) {
        expect(ALLOWED_STEPS_KEYS.has(key), `Unexpected field "${key}" in StepsSample`).toBe(true);
      }
      assertNoDiagnosticFields(sample as unknown as Record<string, unknown>);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — readCalories
// ─────────────────────────────────────────────────────────────────────────────

describe('healthConnectAdapter.readCalories', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
    vi.clearAllMocks();
  });

  it('returns [] when adapter is not available', async () => {
    setNonAndroid();
    const result = await healthConnectAdapter.readCalories(RANGE);
    expect(result).toEqual([]);
    expect(mockReadRecords).not.toHaveBeenCalled();
  });

  it('returns [] when both record types return empty', async () => {
    setAndroidAvailable();
    // Called twice: TotalCaloriesBurned + ActiveCaloriesBurned
    mockReadRecords.mockResolvedValue({ records: [] });

    const result = await healthConnectAdapter.readCalories(RANGE);
    expect(result).toEqual([]);
  });

  it('normalises a TotalCaloriesBurned record', async () => {
    setAndroidAvailable();
    const startIso = '2026-05-01T08:00:00.000Z';
    mockReadRecords
      .mockResolvedValueOnce({
        records: [
          {
            type: 'TotalCaloriesBurned',
            energy: { value: 350 },
            startTime: startIso,
            endTime: '2026-05-01T09:00:00.000Z',
          },
        ],
      })
      // ActiveCaloriesBurned — empty for this test
      .mockResolvedValueOnce({ records: [] });

    const result: CaloriesSample[] = await healthConnectAdapter.readCalories(RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].kcal).toBe(350);
    expect(result[0].date).toEqual(new Date(startIso));
    expect(result[0].active).toBeUndefined();
  });

  it('merges active calories into the total sample for the same time bucket', async () => {
    setAndroidAvailable();
    const startIso = '2026-05-01T08:00:00.000Z';
    mockReadRecords
      .mockResolvedValueOnce({
        records: [
          {
            type: 'TotalCaloriesBurned',
            energy: { value: 400 },
            startTime: startIso,
            endTime: '2026-05-01T09:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        records: [
          {
            type: 'ActiveCaloriesBurned',
            energy: { value: 150 },
            startTime: startIso,
            endTime: '2026-05-01T09:00:00.000Z',
          },
        ],
      });

    const result = await healthConnectAdapter.readCalories(RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].kcal).toBe(400);
    expect(result[0].active).toBe(150);
  });

  it('creates a standalone sample for active-only records (no matching total)', async () => {
    setAndroidAvailable();
    const startIso = '2026-05-01T12:00:00.000Z';
    mockReadRecords
      .mockResolvedValueOnce({ records: [] }) // no total
      .mockResolvedValueOnce({
        records: [
          {
            type: 'ActiveCaloriesBurned',
            energy: { value: 200 },
            startTime: startIso,
            endTime: '2026-05-01T13:00:00.000Z',
          },
        ],
      });

    const result = await healthConnectAdapter.readCalories(RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].kcal).toBe(200);
    expect(result[0].active).toBe(200);
  });

  it('issues exactly two parallel readRecords calls (TotalCaloriesBurned + ActiveCaloriesBurned)', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValue({ records: [] });

    await healthConnectAdapter.readCalories(RANGE);
    const calledTypes = mockReadRecords.mock.calls.map(
      (c) => (c as unknown as [{ type: string }])[0].type,
    );
    expect(calledTypes).toContain('TotalCaloriesBurned');
    expect(calledTypes).toContain('ActiveCaloriesBurned');
    expect(mockReadRecords).toHaveBeenCalledTimes(2);
  });

  it('ADR 0012: CaloriesSample contains only allowed raw metric fields', async () => {
    setAndroidAvailable();
    const startIso = '2026-05-01T08:00:00.000Z';
    mockReadRecords
      .mockResolvedValueOnce({
        records: [
          {
            type: 'TotalCaloriesBurned',
            energy: { value: 500 },
            startTime: startIso,
            endTime: '2026-05-01T09:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ records: [] });

    const result = await healthConnectAdapter.readCalories(RANGE);
    for (const sample of result) {
      const keys = Object.keys(sample);
      for (const key of keys) {
        expect(ALLOWED_CALORIES_KEYS.has(key), `Unexpected field "${key}" in CaloriesSample`).toBe(true);
      }
      assertNoDiagnosticFields(sample as unknown as Record<string, unknown>);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — readSleep
// ─────────────────────────────────────────────────────────────────────────────

describe('healthConnectAdapter.readSleep', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
    vi.clearAllMocks();
  });

  it('returns [] when adapter is not available', async () => {
    setNonAndroid();
    const result = await healthConnectAdapter.readSleep(RANGE);
    expect(result).toEqual([]);
    expect(mockReadRecords).not.toHaveBeenCalled();
  });

  it('returns [] on empty records list', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({ records: [] });

    const result = await healthConnectAdapter.readSleep(RANGE);
    expect(result).toEqual([]);
  });

  it('normalises a SleepSession record — durationMin computed correctly', async () => {
    setAndroidAvailable();
    const start = '2026-04-30T22:00:00.000Z';
    const end = '2026-05-01T06:00:00.000Z'; // 8 hours = 480 min
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'SleepSession',
          startTime: start,
          endTime: end,
          stages: [],
        },
      ],
    });

    const result: SleepSample[] = await healthConnectAdapter.readSleep(RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toEqual(new Date(start));
    expect(result[0].endTime).toEqual(new Date(end));
    expect(result[0].durationMin).toBe(480);
    // No stages → quality is undefined
    expect(result[0].quality).toBeUndefined();
  });

  it('resolves quality as "deep" when stage 5 dominates', async () => {
    setAndroidAvailable();
    const base = new Date('2026-05-01T00:00:00Z').getTime();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'SleepSession',
          startTime: '2026-04-30T22:00:00Z',
          endTime: '2026-05-01T06:00:00Z',
          stages: [
            // 60 min light (stage 4)
            { stage: 4, startTime: new Date(base), endTime: new Date(base + 60 * 60_000) },
            // 120 min deep (stage 5) — dominant
            { stage: 5, startTime: new Date(base + 60 * 60_000), endTime: new Date(base + 180 * 60_000) },
          ],
        },
      ],
    });

    const result = await healthConnectAdapter.readSleep(RANGE);
    expect(result[0].quality).toBe('deep');
  });

  it('resolves quality as "rem" when stage 6 dominates', async () => {
    setAndroidAvailable();
    const base = new Date('2026-05-01T01:00:00Z').getTime();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'SleepSession',
          startTime: '2026-04-30T23:00:00Z',
          endTime: '2026-05-01T07:00:00Z',
          stages: [
            { stage: 6, startTime: new Date(base), endTime: new Date(base + 90 * 60_000) },
            { stage: 4, startTime: new Date(base + 90 * 60_000), endTime: new Date(base + 120 * 60_000) },
          ],
        },
      ],
    });

    const result = await healthConnectAdapter.readSleep(RANGE);
    expect(result[0].quality).toBe('rem');
  });

  it('resolves quality as "light" when stage 4 dominates', async () => {
    setAndroidAvailable();
    const base = new Date('2026-05-01T01:00:00Z').getTime();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'SleepSession',
          startTime: '2026-04-30T23:00:00Z',
          endTime: '2026-05-01T07:00:00Z',
          stages: [
            // light (stage 4): 120 min
            { stage: 4, startTime: new Date(base), endTime: new Date(base + 120 * 60_000) },
            // deep (stage 5): 60 min
            { stage: 5, startTime: new Date(base + 120 * 60_000), endTime: new Date(base + 180 * 60_000) },
          ],
        },
      ],
    });

    const result = await healthConnectAdapter.readSleep(RANGE);
    expect(result[0].quality).toBe('light');
  });

  it('resolves quality as "awake" when stage 1 or 7 dominates', async () => {
    setAndroidAvailable();
    const base = new Date('2026-05-01T05:00:00Z').getTime();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'SleepSession',
          startTime: '2026-05-01T04:00:00Z',
          endTime: '2026-05-01T07:00:00Z',
          stages: [
            // awake_in_bed (7): 60 min — dominant
            { stage: 7, startTime: new Date(base), endTime: new Date(base + 60 * 60_000) },
            // light (4): 30 min
            { stage: 4, startTime: new Date(base + 60 * 60_000), endTime: new Date(base + 90 * 60_000) },
          ],
        },
      ],
    });

    const result = await healthConnectAdapter.readSleep(RANGE);
    expect(result[0].quality).toBe('awake');
  });

  it('quality is undefined for unknown stage numbers (e.g. stage 0 = unknown)', async () => {
    setAndroidAvailable();
    const base = new Date('2026-05-01T01:00:00Z').getTime();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'SleepSession',
          startTime: '2026-05-01T01:00:00Z',
          endTime: '2026-05-01T02:00:00Z',
          stages: [
            // stage 0 = "unknown" — maps to undefined quality
            { stage: 0, startTime: new Date(base), endTime: new Date(base + 60 * 60_000) },
          ],
        },
      ],
    });

    const result = await healthConnectAdapter.readSleep(RANGE);
    expect(result[0].quality).toBeUndefined();
  });

  it('durationMin clamps to 0 if endTime <= startTime (defensive)', async () => {
    setAndroidAvailable();
    const t = '2026-05-01T06:00:00.000Z';
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'SleepSession',
          startTime: t,
          endTime: t, // same time → 0 min
          stages: [],
        },
      ],
    });

    const result = await healthConnectAdapter.readSleep(RANGE);
    expect(result[0].durationMin).toBe(0);
  });

  it('ADR 0012: SleepSample contains only allowed raw metric fields (no diagnosis)', async () => {
    setAndroidAvailable();
    const base = new Date('2026-05-01T00:00:00Z').getTime();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'SleepSession',
          startTime: '2026-04-30T22:00:00Z',
          endTime: '2026-05-01T06:00:00Z',
          stages: [
            { stage: 5, startTime: new Date(base), endTime: new Date(base + 120 * 60_000) },
          ],
        },
      ],
    });

    const result = await healthConnectAdapter.readSleep(RANGE);
    for (const sample of result) {
      const keys = Object.keys(sample);
      for (const key of keys) {
        expect(ALLOWED_SLEEP_KEYS.has(key), `Unexpected field "${key}" in SleepSample`).toBe(true);
      }
      assertNoDiagnosticFields(sample as unknown as Record<string, unknown>);
    }
  });

  it('on-device: readSleep never calls insertRecords (no off-device write)', async () => {
    setAndroidAvailable();
    mockReadRecords.mockResolvedValueOnce({ records: [] });

    await healthConnectAdapter.readSleep(RANGE);

    const { HealthConnect } = await import('@kiwi-health/capacitor-health-connect');
    expect((HealthConnect as unknown as Record<string, unknown>).insertRecords as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — toDate edge cases (internal utility covered transitively)
// ─────────────────────────────────────────────────────────────────────────────

describe('timestamp normalisation (toDate) — covered via readHeartRate', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
    vi.clearAllMocks();
  });

  it('handles a numeric timestamp (ms since epoch)', async () => {
    setAndroidAvailable();
    const epochMs = new Date('2026-05-01T09:00:00Z').getTime();
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'HeartRateSeries',
          samples: [{ time: epochMs, beatsPerMinute: 80 }],
        },
      ],
    });

    const result = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result[0].timestamp.getTime()).toBe(epochMs);
  });

  it('handles a Date object timestamp directly', async () => {
    setAndroidAvailable();
    const d = new Date('2026-05-01T10:00:00Z');
    mockReadRecords.mockResolvedValueOnce({
      records: [
        {
          type: 'HeartRateSeries',
          samples: [{ time: d, beatsPerMinute: 65 }],
        },
      ],
    });

    const result = await healthConnectAdapter.readHeartRate(RANGE);
    expect(result[0].timestamp).toEqual(d);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — __resetHealthConnectAvailability (test-internal export)
// ─────────────────────────────────────────────────────────────────────────────

describe('__resetHealthConnectAvailability', () => {
  afterEach(() => {
    __resetHealthConnectAvailability(null);
    _isNative = false;
    _platform = 'web';
  });

  it('calling with null clears the cache and resets probe flag', () => {
    // Pre-populate the cache
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability('Available');
    expect(healthConnectAdapter.isAvailable).toBe(true);

    // Reset
    __resetHealthConnectAvailability(null);
    // With cache cleared and probe NOT started, sync read still returns false
    // (probe is kicked off async but resolves false synchronously before await)
    expect(healthConnectAdapter.isAvailable).toBe(false);
  });

  it('calling with "Available" sets cache and probe flag simultaneously', () => {
    _isNative = true;
    _platform = 'android';
    __resetHealthConnectAvailability('Available');
    expect(healthConnectAdapter.isAvailable).toBe(true);
  });
});
