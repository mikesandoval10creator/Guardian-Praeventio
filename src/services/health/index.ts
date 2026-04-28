/**
 * Health adapter facade.
 *
 * `getHealthAdapter()` is the single entry point the rest of the app should
 * use to read worker biometrics. It picks the best available implementation
 * at runtime:
 *
 *   1. Native Android with Health Connect installed -> `healthConnectAdapter`.
 *   2. Native iOS with HealthKit available         -> `healthKitAdapter`.
 *   3. Otherwise (web, or native without the plugin yet)
 *      -> `googleFitAdapter` while Google Fit is still alive (deprecated).
 *   4. Final fallback (no adapter reachable at all) -> `noopAdapter`.
 *
 * Tests can override the platform check via `__setCapacitorChecker(...)`
 * and `__setPlatformChecker(...)`.
 */

import { Capacitor } from '@capacitor/core';
import { googleFitAdapter } from './googleFitAdapter';
import { healthConnectAdapter } from './healthConnectAdapter';
import { healthKitAdapter } from './healthKitAdapter';
import type {
  CaloriesSample,
  HealthAdapter,
  HealthDataRange,
  HealthScope,
  HeartRateSample,
  PermissionResult,
  SleepSample,
  StepsSample,
} from './types';

/**
 * Always-available fallback. Used on web and as the test-default before
 * any adapter is wired up. Returns empty arrays; never throws.
 */
export const noopAdapter: HealthAdapter = {
  name: 'noop',
  isAvailable: false,
  platform: 'web',
  async requestPermissions(scopes: HealthScope[]): Promise<PermissionResult> {
    return { granted: [], denied: scopes };
  },
  async readHeartRate(_range: HealthDataRange): Promise<HeartRateSample[]> {
    return [];
  },
  async readSteps(_range: HealthDataRange): Promise<StepsSample[]> {
    return [];
  },
  async readCalories(_range: HealthDataRange): Promise<CaloriesSample[]> {
    return [];
  },
  async readSleep(_range: HealthDataRange): Promise<SleepSample[]> {
    return [];
  },
};

/** Test seam: lets `healthFacade.test.ts` mock `Capacitor.isNativePlatform()`. */
type IsNativeChecker = () => boolean;
let isNativeChecker: IsNativeChecker = () => Capacitor.isNativePlatform();

/** Test seam: lets tests mock `Capacitor.getPlatform()` ('android' | 'ios' | 'web'). */
type PlatformChecker = () => string;
let platformChecker: PlatformChecker = () => Capacitor.getPlatform();

/** @internal — exported only for tests. */
export function __setCapacitorChecker(next: IsNativeChecker | null): void {
  isNativeChecker = next ?? (() => Capacitor.isNativePlatform());
}

/** @internal — exported only for tests. */
export function __setPlatformChecker(next: PlatformChecker | null): void {
  platformChecker = next ?? (() => Capacitor.getPlatform());
}

/**
 * Pick the best health adapter for the current runtime.
 *
 * Selection order (first match wins):
 *   1. Native Android + Health Connect available -> `healthConnectAdapter`.
 *   2. Native iOS + HealthKit available          -> `healthKitAdapter`.
 *   3. `googleFitAdapter` if `isAvailable` (deprecated, but live until 2026).
 *   4. `noopAdapter` as the final fallback.
 */
export function getHealthAdapter(): HealthAdapter {
  if (isNativeChecker()) {
    const platform = platformChecker();
    if (platform === 'android' && healthConnectAdapter.isAvailable) {
      return healthConnectAdapter;
    }
    if (platform === 'ios' && healthKitAdapter.isAvailable) {
      return healthKitAdapter;
    }
  }
  if (googleFitAdapter.isAvailable) {
    return googleFitAdapter;
  }
  return noopAdapter;
}

// Re-exports so callers only need a single import path.
export { googleFitAdapter, healthConnectAdapter, healthKitAdapter };
export type {
  CaloriesSample,
  HealthAdapter,
  HealthAdapterName,
  HealthAdapterPlatform,
  HealthDataRange,
  HealthScope,
  HeartRateSample,
  HeartRateSource,
  PermissionResult,
  SleepQuality,
  SleepSample,
  StepsSample,
  ActivitySource,
} from './types';
