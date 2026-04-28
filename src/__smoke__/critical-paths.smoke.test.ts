/**
 * Smoke: critical paths meta-test.
 *
 * One test per major service / utility module. We dynamic-import each
 * module so the test reports which import broke instead of failing the
 * entire suite at module-load time. This catches the common case where
 * a refactor removes/renames an export, the unit tests of the touched
 * module still pass, but a downstream consumer's import chain breaks at
 * app startup. The smoke runs first in CI so a broken import surfaces
 * before the heavier unit pass.
 */
import { describe, expect, it, vi } from 'vitest';

// Capacitor + native plugins must be stubbed for the health module to
// import in a Node environment.
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

describe('smoke: critical paths', () => {
  it('all major modules load without errors', async () => {
    await expect(import('../services/pricing/tiers')).resolves.toBeDefined();
    await expect(import('../services/billing/invoice')).resolves.toBeDefined();
    await expect(import('../services/billing/webpayAdapter')).resolves.toBeDefined();
    await expect(import('../services/normativa/locationNormativa')).resolves.toBeDefined();
    await expect(import('../services/normativa/countryPacks')).resolves.toBeDefined();
    await expect(import('../services/calendar/predictions')).resolves.toBeDefined();
    await expect(import('../services/zettelkasten/climateRiskCoupling')).resolves.toBeDefined();
    await expect(import('../services/security/kmsEnvelope')).resolves.toBeDefined();
    await expect(import('../services/health')).resolves.toBeDefined();
    await expect(import('../services/ai')).resolves.toBeDefined();
    await expect(import('../services/sii')).resolves.toBeDefined();
    await expect(import('../services/observability')).resolves.toBeDefined();
    await expect(import('../services/capacity/tierEvaluation')).resolves.toBeDefined();
  });

  it('logger exported correctly', async () => {
    const { logger } = await import('../utils/logger');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});
