// Praeventio Guard — production loader for the proximity engine's plugin
// contract (Phase 5 D1 islands: proximityModeDetector orphan → wired).
//
// The pure engine (`proximityModeDetector.ts`, Sprint 49 C.3) declares the
// `ProximityPluginContract` it consumes: addListener('proximityChanged') +
// getCurrent(). This module is the single place that resolves a real
// implementation of that contract for the bridge hook (`useProximityMode`).
//
// HONEST HARDWARE GAP (CLAUDE.md rule #13 — registered in
// docs/stubs-inventory.md):
//
//   The installed `@capgo/capacitor-proximity` v8.1.2 exposes ONLY
//   enable()/disable()/getStatus()/getPluginVersion():
//     - Android (`CapacitorProximity.java`): listens to TYPE_PROXIMITY
//       natively and dims the app window while covered — it NEVER calls
//       `notifyListeners`, so the near/far state is invisible to JS.
//     - iOS (`CapacitorProximity.swift`): toggles
//       `UIDevice.isProximityMonitoringEnabled` (OS blanks the screen when
//       near) — `UIDeviceProximityStateDidChange` is not bridged either.
//
//   The engine's contract therefore CANNOT be satisfied by this dependency
//   today. Returning a fake event source (e.g. visibilitychange as a
//   near-proxy) was rejected: misclassifying "screen off" as "in pocket"
//   feeds a LIFE-SAFETY threshold (fall-detection sensitivity), and enabling
//   native monitoring can blank the screen and pause the very DeviceMotion
//   stream fall detection depends on.
//
// TODO(sprint-D1-followup): mobile owner — bridge proximity events to JS
// (extend `packages/capacitor-mesh` or fork @capgo to emit
// 'proximityChanged' via notifyListeners + expose getCurrent()), then return
// the adapted plugin here and retire the stubs-inventory entry. The pin
// tests in `proximityPluginAdapter.test.ts` fail loudly when that happens.
//
// Until then this loader returns `null`: `useProximityMode` stays inert
// ('normal' mode, neutral policy → unchanged 25 m/s² fall threshold), so the
// gap is invisible to end users (rule #13b). The full TS chain
// (engine → hook → sensorBus → FallDetectionMonitor threshold) is already
// real and exercised through the DI contract in tests.

import { Capacitor } from '@capacitor/core';
import { logger } from '../../utils/logger';
import type { ProximityPluginContract } from './proximityModeDetector';

/**
 * Resolves a `ProximityPluginContract` implementation for the current
 * platform, or `null` when no event-bridged proximity source exists.
 * Never throws — proximity is an enhancement layer over life-safety flows.
 */
export async function loadProximityPlugin(): Promise<ProximityPluginContract | null> {
  // Browsers expose no proximity hardware API (the legacy `userproximity`
  // event was removed from the platform).
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const { CapacitorProximity } = await import('@capgo/capacitor-proximity');
    const status = await CapacitorProximity.getStatus();
    // Operational visibility: log how many devices WOULD benefit once the
    // native event bridge ships (measurable impact of the declared gap).
    logger.info('proximityPluginAdapter: native sensor status (no JS event bridge in @capgo v8.1.2 — returning null)', {
      available: status.available,
      platform: status.platform,
    });
    return null;
  } catch (err) {
    logger.warn('proximityPluginAdapter: proximity plugin unavailable', { err });
    return null;
  }
}
