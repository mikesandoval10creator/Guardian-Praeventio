/**
 * TDD on `getHealthAdapter()` — the runtime adapter selection logic.
 *
 * We mock `@capacitor/core` to control `isNativePlatform()` independently
 * of the JSDOM/node env, and we toggle each adapter's `isAvailable` via
 * `Object.defineProperty` (the type's `readonly` is a compile-time hint
 * only).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    registerPlugin: () => ({}),
  },
}));

// The Health Connect plugin is Android-native; in the unit test environment
// we replace its surface with stubs so the adapter module loads without
// touching the Capacitor bridge.
vi.mock('@kiwi-health/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: vi.fn(async () => ({ availability: 'NotSupported' })),
    requestHealthPermissions: vi.fn(async () => ({
      grantedPermissions: [],
      hasAllPermissions: false,
    })),
    checkHealthPermissions: vi.fn(async () => ({
      grantedPermissions: [],
      hasAllPermissions: false,
    })),
    readRecords: vi.fn(async () => ({ records: [] })),
    readRecord: vi.fn(async () => ({ record: null })),
    insertRecords: vi.fn(async () => ({ recordIds: [] })),
    revokeHealthPermissions: vi.fn(async () => undefined),
    openHealthConnectSetting: vi.fn(async () => undefined),
    getChangesToken: vi.fn(async () => ({ token: '' })),
    getChanges: vi.fn(async () => ({ changes: [], nextToken: '' })),
  },
}));

// HealthKit plugin is iOS-native; mock its surface so the adapter module
// loads on every CI environment without touching the Capacitor bridge.
vi.mock('@perfood/capacitor-healthkit', () => ({
  CapacitorHealthkit: {
    requestAuthorization: vi.fn(async () => undefined),
    queryHKitSampleType: vi.fn(async () => ({ countReturn: 0, resultData: [] })),
    isAvailable: vi.fn(async () => undefined),
    multipleQueryHKitSampleType: vi.fn(async () => ({ countReturn: 0, resultData: [] })),
    isEditionAuthorized: vi.fn(async () => undefined),
    multipleIsEditionAuthorized: vi.fn(async () => undefined),
  },
  SampleNames: {
    HEART_RATE: 'heartRate',
    STEP_COUNT: 'stepCount',
    ACTIVE_ENERGY_BURNED: 'activeEnergyBurned',
    BASAL_ENERGY_BURNED: 'basalEnergyBurned',
    SLEEP_ANALYSIS: 'sleepAnalysis',
  },
}));

import {
  __setCapacitorChecker,
  __setPlatformChecker,
  getHealthAdapter,
  googleFitAdapter,
  healthConnectAdapter,
  healthKitAdapter,
  noopAdapter,
} from './index';

function setAvailable(adapter: { isAvailable: boolean }, value: boolean) {
  Object.defineProperty(adapter, 'isAvailable', {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

const originalHC = healthConnectAdapter.isAvailable;
const originalHK = healthKitAdapter.isAvailable;
const originalGF = googleFitAdapter.isAvailable;

describe('getHealthAdapter — facade selection', () => {
  beforeEach(() => {
    setAvailable(healthConnectAdapter, originalHC);
    setAvailable(healthKitAdapter, originalHK);
    setAvailable(googleFitAdapter, originalGF);
    __setCapacitorChecker(null);
    __setPlatformChecker(null);
  });

  afterEach(() => {
    setAvailable(healthConnectAdapter, originalHC);
    setAvailable(healthKitAdapter, originalHK);
    setAvailable(googleFitAdapter, originalGF);
    __setCapacitorChecker(null);
    __setPlatformChecker(null);
  });

  it('returns health-connect on native Android when health-connect is available', () => {
    __setCapacitorChecker(() => true);
    __setPlatformChecker(() => 'android');
    setAvailable(healthConnectAdapter, true);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('health-connect');
  });

  it('returns healthkit on native iOS when healthkit is available', () => {
    __setCapacitorChecker(() => true);
    __setPlatformChecker(() => 'ios');
    setAvailable(healthKitAdapter, true);
    setAvailable(healthConnectAdapter, false);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('healthkit');
  });

  it('does NOT pick health-connect on iOS even if its isAvailable says true', () => {
    // Defense-in-depth: the platform branch must gate before isAvailable.
    __setCapacitorChecker(() => true);
    __setPlatformChecker(() => 'ios');
    setAvailable(healthConnectAdapter, true);
    setAvailable(healthKitAdapter, false);
    setAvailable(googleFitAdapter, true);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('google-fit-deprecated');
  });

  it('falls back to google-fit when native Android but health-connect not available', () => {
    __setCapacitorChecker(() => true);
    __setPlatformChecker(() => 'android');
    setAvailable(healthConnectAdapter, false);
    setAvailable(googleFitAdapter, true);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('google-fit-deprecated');
  });

  it('falls back to google-fit on iOS when healthkit is unavailable', () => {
    __setCapacitorChecker(() => true);
    __setPlatformChecker(() => 'ios');
    setAvailable(healthKitAdapter, false);
    setAvailable(googleFitAdapter, true);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('google-fit-deprecated');
  });

  it('returns google-fit on web while it is still alive (deprecated wrapper)', () => {
    __setCapacitorChecker(() => false);
    __setPlatformChecker(() => 'web');
    setAvailable(healthConnectAdapter, false);
    setAvailable(healthKitAdapter, false);
    setAvailable(googleFitAdapter, true);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('google-fit-deprecated');
  });

  it('returns noop when neither native adapter nor google-fit is available', () => {
    __setCapacitorChecker(() => false);
    __setPlatformChecker(() => 'web');
    setAvailable(healthConnectAdapter, false);
    setAvailable(healthKitAdapter, false);
    setAvailable(googleFitAdapter, false);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('noop');
    expect(adapter.isAvailable).toBe(false);
  });
});

describe('noopAdapter — read methods do not throw and return []', () => {
  const range = { start: new Date('2026-04-21'), end: new Date('2026-04-28') };

  it('readHeartRate returns []', async () => {
    await expect(noopAdapter.readHeartRate(range)).resolves.toEqual([]);
  });

  it('readSteps returns []', async () => {
    await expect(noopAdapter.readSteps(range)).resolves.toEqual([]);
  });

  it('readCalories returns []', async () => {
    await expect(noopAdapter.readCalories(range)).resolves.toEqual([]);
  });

  it('readSleep returns []', async () => {
    await expect(noopAdapter.readSleep(range)).resolves.toEqual([]);
  });

  it('requestPermissions reports every scope as denied', async () => {
    const result = await noopAdapter.requestPermissions(['heart-rate', 'steps']);
    expect(result.granted).toEqual([]);
    expect(result.denied).toEqual(['heart-rate', 'steps']);
  });
});

describe('adapter identity fields are consistent', () => {
  it('healthConnectAdapter has the right name and platform', () => {
    expect(healthConnectAdapter.name).toBe('health-connect');
    expect(healthConnectAdapter.platform).toBe('capacitor');
  });

  it('healthKitAdapter has the right name and platform', () => {
    expect(healthKitAdapter.name).toBe('healthkit');
    expect(healthKitAdapter.platform).toBe('capacitor');
  });

  it('googleFitAdapter is marked deprecated by name and is on web platform', () => {
    expect(googleFitAdapter.name).toBe('google-fit-deprecated');
    expect(googleFitAdapter.platform).toBe('web');
  });

  it('noopAdapter is web + unavailable by definition', () => {
    expect(noopAdapter.name).toBe('noop');
    expect(noopAdapter.platform).toBe('web');
    expect(noopAdapter.isAvailable).toBe(false);
  });
});
