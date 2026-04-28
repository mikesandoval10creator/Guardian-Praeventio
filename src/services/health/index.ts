/**
 * Health adapter facade.
 *
 * `getHealthAdapter()` is the single entry point the rest of the app should
 * use to read worker biometrics. It picks the best available implementation
 * at runtime:
 *
 *   1. On a Capacitor native platform with Health Connect installed
 *      -> `healthConnectAdapter`.
 *   2. Otherwise (web, or native without the plugin yet)
 *      -> `googleFitAdapter` while Google Fit is still alive.
 *   3. Web/SSR/test environments where neither is reachable
 *      -> `noopAdapter` (returns `[]` for every read; never throws).
 *
 * Tests can override the platform check via `__setCapacitorChecker(...)`.
 */

import { Capacitor } from '@capacitor/core';
import { googleFitAdapter } from './googleFitAdapter';
import { healthConnectAdapter } from './healthConnectAdapter';
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

/** @internal — exported only for tests. */
export function __setCapacitorChecker(next: IsNativeChecker | null): void {
  isNativeChecker = next ?? (() => Capacitor.isNativePlatform());
}

/**
 * Pick the best health adapter for the current runtime.
 *
 * Selection order (first match wins):
 *   1. `healthConnectAdapter` if `isAvailable` AND we're on a native platform.
 *   2. `googleFitAdapter` if `isAvailable` (deprecated, but live until 2026).
 *   3. `noopAdapter` as the final fallback.
 */
export function getHealthAdapter(): HealthAdapter {
  if (isNativeChecker() && healthConnectAdapter.isAvailable) {
    return healthConnectAdapter;
  }
  if (googleFitAdapter.isAvailable) {
    return googleFitAdapter;
  }
  return noopAdapter;
}

// Re-exports so callers only need a single import path.
export { googleFitAdapter, healthConnectAdapter };
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
