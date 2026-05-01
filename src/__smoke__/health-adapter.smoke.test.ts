/**
 * Smoke: health adapter facade selection across mocked platforms.
 *
 * Mirrors `src/services/health/healthFacade.test.ts` at a high level — the
 * full unit test exhaustively covers selection, this smoke just makes sure
 * the four canonical branches still resolve to the right adapter and the
 * noop adapter remains a safe always-available fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    registerPlugin: () => ({}),
  },
}));

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
} from '../services/health';

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

describe('smoke: getHealthAdapter facade selection', () => {
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

  it('non-native platform → noop (when google-fit also unavailable)', () => {
    __setCapacitorChecker(() => false);
    __setPlatformChecker(() => 'web');
    setAvailable(healthConnectAdapter, false);
    setAvailable(healthKitAdapter, false);
    setAvailable(googleFitAdapter, false);
    expect(getHealthAdapter().name).toBe('noop');
  });

  it('native iOS + healthkit available → healthkit', () => {
    __setCapacitorChecker(() => true);
    __setPlatformChecker(() => 'ios');
    setAvailable(healthKitAdapter, true);
    setAvailable(healthConnectAdapter, false);
    expect(getHealthAdapter().name).toBe('healthkit');
  });

  it('native Android + healthconnect available → health-connect', () => {
    __setCapacitorChecker(() => true);
    __setPlatformChecker(() => 'android');
    setAvailable(healthConnectAdapter, true);
    expect(getHealthAdapter().name).toBe('health-connect');
  });

  it('native + neither native available → google-fit-deprecated', () => {
    __setCapacitorChecker(() => true);
    __setPlatformChecker(() => 'android');
    setAvailable(healthConnectAdapter, false);
    setAvailable(healthKitAdapter, false);
    setAvailable(googleFitAdapter, true);
    expect(getHealthAdapter().name).toBe('google-fit-deprecated');
  });

  it('noopAdapter.readHeartRate returns [] without throwing', async () => {
    const range = { start: new Date('2026-04-21'), end: new Date('2026-04-28') };
    await expect(noopAdapter.readHeartRate(range)).resolves.toEqual([]);
  });
});
