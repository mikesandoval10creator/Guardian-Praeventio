// proximityPluginAdapter — production loader pin tests (CLAUDE.md rule #13c).
//
// DISCOVERY (Phase 5 D1): the installed `@capgo/capacitor-proximity` v8.1.2
// exposes ONLY enable()/disable()/getStatus()/getPluginVersion(). Its Android
// implementation dims the app window natively and its iOS implementation
// toggles `UIDevice.isProximityMonitoringEnabled` — NEITHER bridges near/far
// transitions to JS (zero `notifyListeners` calls in the plugin source). The
// engine's `ProximityPluginContract` (addListener('proximityChanged') +
// getCurrent()) therefore cannot be satisfied by this dependency today.
//
// These tests PIN the declared placeholder shape: the loader returns `null`
// on every platform until a native event bridge ships, so `useProximityMode`
// stays inert ('normal' mode, neutral policy) and end users see no behavior
// change. If someone implements the bridge, these pins fail loudly and the
// stubs-inventory entry must be retired together.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getStatus: vi.fn(async () => ({
    available: true,
    enabled: false,
    platform: 'android' as const,
  })),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: h.isNativePlatform },
}));
vi.mock('@capgo/capacitor-proximity', () => ({
  CapacitorProximity: { getStatus: h.getStatus },
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: h.logInfo, warn: h.logWarn, error: vi.fn(), debug: vi.fn() },
}));

import { loadProximityPlugin } from './proximityPluginAdapter';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadProximityPlugin — honest hardware gap (rule #13)', () => {
  it('returns null on web (no proximity hardware API in browsers)', async () => {
    h.isNativePlatform.mockReturnValue(false);
    await expect(loadProximityPlugin()).resolves.toBeNull();
    expect(h.getStatus).not.toHaveBeenCalled();
  });

  it('returns null on native EVEN with an available sensor — @capgo v8.1.2 has no JS event bridge', async () => {
    h.isNativePlatform.mockReturnValue(true);
    await expect(loadProximityPlugin()).resolves.toBeNull();
    // Operational visibility: the sensor availability is logged so the gap's
    // real-world impact (devices that WOULD benefit) is measurable.
    expect(h.logInfo).toHaveBeenCalledWith(
      expect.stringContaining('proximityPluginAdapter'),
      expect.objectContaining({ available: true }),
    );
  });

  it('returns null (never throws) when the native plugin call fails', async () => {
    h.isNativePlatform.mockReturnValue(true);
    h.getStatus.mockRejectedValueOnce(new Error('plugin not registered'));
    await expect(loadProximityPlugin()).resolves.toBeNull();
    expect(h.logWarn).toHaveBeenCalled();
  });
});
