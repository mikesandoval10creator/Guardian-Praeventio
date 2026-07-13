import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const nativePlugin = {
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({
      available: true,
      enabled: false,
      platform: 'android' as const,
    })),
    getCurrent: vi.fn(async () => ({
      state: 'far' as const,
      timestamp: Date.now(),
    })),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
    removeAllListeners: vi.fn(async () => undefined),
    getPluginVersion: vi.fn(async () => ({ version: '0.1.0' })),
  };
  return {
    isNativePlatform: vi.fn(() => false),
    nativePlugin,
    logInfo: vi.fn(),
    logWarn: vi.fn(),
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: h.isNativePlatform },
}));
vi.mock('@praeventio/capacitor-proximity', () => ({
  CapacitorProximity: h.nativePlugin,
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: h.logInfo, warn: h.logWarn, error: vi.fn(), debug: vi.fn() },
}));

import { loadProximityPlugin } from './proximityPluginAdapter';

beforeEach(() => {
  vi.clearAllMocks();
  h.isNativePlatform.mockReturnValue(false);
});

describe('loadProximityPlugin — first-party native event bridge', () => {
  it('returns null on web without touching native hardware', async () => {
    await expect(loadProximityPlugin()).resolves.toBeNull();
    expect(h.nativePlugin.getStatus).not.toHaveBeenCalled();
  });

  it('returns the auditable native plugin when the sensor is available', async () => {
    h.isNativePlatform.mockReturnValue(true);

    await expect(loadProximityPlugin()).resolves.toBe(h.nativePlugin);
    expect(h.logInfo).toHaveBeenCalledWith(
      expect.stringContaining('proximityPluginAdapter'),
      expect.objectContaining({ available: true, platform: 'android' }),
    );
  });

  it('returns null when the native device has no proximity sensor', async () => {
    h.isNativePlatform.mockReturnValue(true);
    h.nativePlugin.getStatus.mockResolvedValueOnce({
      available: false,
      enabled: false,
      platform: 'android',
    });

    await expect(loadProximityPlugin()).resolves.toBeNull();
  });

  it('returns null and logs when native plugin discovery fails', async () => {
    h.isNativePlatform.mockReturnValue(true);
    h.nativePlugin.getStatus.mockRejectedValueOnce(new Error('plugin not registered'));

    await expect(loadProximityPlugin()).resolves.toBeNull();
    expect(h.logWarn).toHaveBeenCalled();
  });
});
