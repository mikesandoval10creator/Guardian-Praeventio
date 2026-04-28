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

import {
  __setCapacitorChecker,
  getHealthAdapter,
  googleFitAdapter,
  healthConnectAdapter,
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
const originalGF = googleFitAdapter.isAvailable;

describe('getHealthAdapter — facade selection', () => {
  beforeEach(() => {
    setAvailable(healthConnectAdapter, originalHC);
    setAvailable(googleFitAdapter, originalGF);
    __setCapacitorChecker(null);
  });

  afterEach(() => {
    setAvailable(healthConnectAdapter, originalHC);
    setAvailable(googleFitAdapter, originalGF);
    __setCapacitorChecker(null);
  });

  it('returns health-connect when Capacitor is native AND health-connect is available', () => {
    __setCapacitorChecker(() => true);
    setAvailable(healthConnectAdapter, true);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('health-connect');
  });

  it('falls back to google-fit when native but health-connect not available', () => {
    __setCapacitorChecker(() => true);
    setAvailable(healthConnectAdapter, false);
    setAvailable(googleFitAdapter, true);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('google-fit-deprecated');
  });

  it('returns google-fit on web while it is still alive (deprecated wrapper)', () => {
    __setCapacitorChecker(() => false);
    setAvailable(healthConnectAdapter, false);
    setAvailable(googleFitAdapter, true);

    const adapter = getHealthAdapter();
    expect(adapter.name).toBe('google-fit-deprecated');
  });

  it('returns noop when neither health-connect nor google-fit is available', () => {
    __setCapacitorChecker(() => false);
    setAvailable(healthConnectAdapter, false);
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
