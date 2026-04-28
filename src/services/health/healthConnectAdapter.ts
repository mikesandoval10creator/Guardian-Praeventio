/**
 * Health Connect adapter (STUB — Round 1 of migration).
 *
 * This file is the typed contract that the eventual Capacitor plugin
 * implementation will fulfil. NOTHING here calls a real plugin yet.
 *
 * Why a stub: Agent N5 owns `package.json` this round (Webpay work), and
 * installing `@capacitor-community/health-connect` would race that. The
 * facade in `./index.ts` picks this adapter only when `isAvailable` flips
 * to `true`, so the stub is safely inert in production.
 *
 * NEXT ROUND — wiring checklist:
 *   1. `npm i @capacitor-community/health-connect@^1.0.0`
 *      (verify the latest at https://github.com/capacitor-community/health-connect)
 *      iOS HealthKit may need a separate plugin (`@capacitor-community/health`
 *      or `cordova-plugin-health` via Capawesome wrapper) — pick one that
 *      bridges both stores.
 *   2. Replace each `throw notImplemented(...)` below with a real call.
 *   3. Set `isAvailable: true` after `HealthConnect.checkAvailability()` resolves.
 *   4. Android-only setup:
 *      - `android/app/build.gradle`: `minSdkVersion 26` (Health Connect requires 26+).
 *      - `AndroidManifest.xml`: add `<queries>` for the Health Connect package
 *        (`com.google.android.apps.healthdata`) and read permissions for each
 *        record type the app reads (HEART_RATE, STEPS, ACTIVE_CALORIES_BURNED,
 *        TOTAL_CALORIES_BURNED, SLEEP_SESSION).
 *      - `MainActivity.kt`: declare the `androidx.health.connect` permission
 *        contract for the launcher.
 *   5. iOS setup (HealthKit): enable HealthKit capability in Xcode, add
 *      `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription` to
 *      Info.plist, and ensure the Capacitor 5+ runtime is in use (already true
 *      in this repo — see `package.json` `@capacitor/ios@^8.3.0`).
 */

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

const NOT_IMPLEMENTED_MSG =
  'NotImplemented — install @capacitor-community/health-connect first. ' +
  'See HEALTH_CONNECT_MIGRATION.md.';

function notImplemented(method: string): Error {
  return new Error(`[healthConnectAdapter.${method}] ${NOT_IMPLEMENTED_MSG}`);
}

/**
 * Stub implementation. `isAvailable` is hard-coded to `false` so the
 * runtime facade falls through to the Google Fit deprecated wrapper or
 * the noop adapter. Once the plugin is installed, replace the
 * `isAvailable` getter with a runtime probe.
 */
export const healthConnectAdapter: HealthAdapter = {
  name: 'health-connect',
  isAvailable: false,
  platform: 'capacitor',

  /**
   * Request user consent for the listed scopes.
   * Wraps Health Connect's `requestPermission(...)` and HealthKit's
   * `requestAuthorization(toShare:read:)`.
   *
   * @see https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started#request-permissions
   * @see https://developer.apple.com/documentation/healthkit/protecting_user_privacy
   */
  async requestPermissions(_scopes: HealthScope[]): Promise<PermissionResult> {
    throw notImplemented('requestPermissions');
  },

  /**
   * Read heart-rate samples in the range.
   * Health Connect record type: `HeartRateRecord`.
   * HealthKit quantity type: `HKQuantityTypeIdentifierHeartRate`.
   *
   * @see https://developer.android.com/reference/androidx/health/connect/client/records/HeartRateRecord
   */
  async readHeartRate(_range: HealthDataRange): Promise<HeartRateSample[]> {
    throw notImplemented('readHeartRate');
  },

  /**
   * Read daily step counts in the range.
   * Health Connect record type: `StepsRecord`.
   * HealthKit quantity type: `HKQuantityTypeIdentifierStepCount`.
   *
   * @see https://developer.android.com/reference/androidx/health/connect/client/records/StepsRecord
   */
  async readSteps(_range: HealthDataRange): Promise<StepsSample[]> {
    throw notImplemented('readSteps');
  },

  /**
   * Read calorie burn (active + basal) in the range.
   * Health Connect record types: `ActiveCaloriesBurnedRecord`,
   * `TotalCaloriesBurnedRecord`, `BasalMetabolicRateRecord`.
   * HealthKit: `HKQuantityTypeIdentifierActiveEnergyBurned`,
   * `HKQuantityTypeIdentifierBasalEnergyBurned`.
   */
  async readCalories(_range: HealthDataRange): Promise<CaloriesSample[]> {
    throw notImplemented('readCalories');
  },

  /**
   * Read sleep sessions in the range.
   * Health Connect record type: `SleepSessionRecord` (with stages).
   * HealthKit category type: `HKCategoryTypeIdentifierSleepAnalysis`.
   *
   * @see https://developer.android.com/reference/androidx/health/connect/client/records/SleepSessionRecord
   */
  async readSleep(_range: HealthDataRange): Promise<SleepSample[]> {
    throw notImplemented('readSleep');
  },
};
