/**
 * Health Connect adapter — REAL implementation (Round 2).
 *
 * Backed by `@kiwi-health/capacitor-health-connect@^0.0.40`. The plugin is
 * Android-only at runtime (no iOS HealthKit support); on web/iOS the calls
 * resolve to a no-op via `isAvailable === false`, and the facade in
 * `./index.ts` falls through to `googleFitAdapter` (deprecated) or
 * `noopAdapter`.
 *
 * iOS HealthKit parity is intentionally deferred until the Round 3 follow-up:
 * a separate `@perfood/capacitor-healthkit` adapter will plug into the same
 * facade with an `'ios'` platform branch.
 *
 * Plugin API mapping:
 *   - HeartRate     -> RecordType `'HeartRateSeries'` (sample list inside)
 *   - Steps         -> RecordType `'Steps'` (count per session)
 *   - Calories      -> `'ActiveCaloriesBurned'` + `'TotalCaloriesBurned'`
 *                      (basal split unavailable in this plugin version)
 *   - Sleep         -> RecordType `'SleepSession'` with stage list
 *
 * Permission scopes are mapped to one or more Health Connect record types per
 * the table in `scopeToRecordTypes`. The plugin returns granted/denied as a
 * flat string array of record types; we round-trip those back to our
 * `HealthScope` set so the rest of the app stays decoupled from the plugin.
 *
 * Native config still required (NOT done in this round — see migration doc):
 *   - `android/app/build.gradle`: minSdkVersion 26.
 *   - `AndroidManifest.xml`: `<queries>` for `com.google.android.apps.healthdata`
 *     plus `android.permission.health.READ_*` entries for each record type.
 *   - `MainActivity.kt`: register the Health Connect permission contract.
 */

import { Capacitor } from '@capacitor/core';
import {
  HealthConnect,
  type HealthConnectAvailability,
  type RecordType,
  type SleepSessionStage,
  type TimeRangeFilter,
} from '@kiwi-health/capacitor-health-connect';

import type {
  CaloriesSample,
  HealthAdapter,
  HealthDataRange,
  HealthScope,
  HeartRateSample,
  PermissionResult,
  SleepQuality,
  SleepSample,
  StepsSample,
} from './types';

/** Plugin returns timestamps as Date (Capacitor 5 bridge) or ISO string (older). */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date(NaN);
}

/** Map our scopes to Health Connect record types. */
function scopeToRecordTypes(scope: HealthScope): RecordType[] {
  switch (scope) {
    case 'heart-rate':
      return ['HeartRateSeries'];
    case 'steps':
      return ['Steps'];
    case 'calories':
      return ['ActiveCaloriesBurned', 'TotalCaloriesBurned'];
    case 'sleep':
      return ['SleepSession'];
    case 'body-composition':
      return ['Weight', 'BodyFat', 'LeanBodyMass'];
    default:
      return [];
  }
}

/** Reverse mapping: which scopes does a granted record-type satisfy? */
function recordTypeToScope(type: string): HealthScope | null {
  switch (type) {
    case 'HeartRateSeries':
      return 'heart-rate';
    case 'Steps':
      return 'steps';
    case 'ActiveCaloriesBurned':
    case 'TotalCaloriesBurned':
      return 'calories';
    case 'SleepSession':
      return 'sleep';
    case 'Weight':
    case 'BodyFat':
    case 'LeanBodyMass':
      return 'body-composition';
    default:
      return null;
  }
}

/**
 * Health Connect's stage enum (numeric):
 *   0 unknown, 1 awake, 2 sleeping (generic), 3 out_of_bed,
 *   4 light, 5 deep, 6 rem, 7 awake_in_bed.
 * We collapse to the four buckets defined in `SleepQuality`.
 */
function stageNumberToQuality(stage: number): SleepQuality | undefined {
  switch (stage) {
    case 4:
      return 'light';
    case 5:
      return 'deep';
    case 6:
      return 'rem';
    case 1:
    case 7:
      return 'awake';
    default:
      return undefined;
  }
}

function buildRange(range: HealthDataRange): TimeRangeFilter {
  return { type: 'between', startTime: range.start, endTime: range.end };
}

/**
 * Cached availability probe. Health Connect availability does not change at
 * runtime (the system app is either installed or it isn't), so we resolve it
 * once on first access.
 *
 * The getter is synchronous (the `HealthAdapter` contract requires a boolean,
 * not a promise), so we conservatively return `false` until the async probe
 * has resolved. The facade re-checks `isAvailable` on every `getHealthAdapter`
 * call, so the next invocation after init will see the true value.
 */
let cachedAvailability: HealthConnectAvailability | null = null;
let availabilityProbeStarted = false;

function startAvailabilityProbe(): void {
  if (availabilityProbeStarted) return;
  availabilityProbeStarted = true;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    cachedAvailability = 'NotSupported';
    return;
  }
  HealthConnect.checkAvailability()
    .then((result) => {
      cachedAvailability = result.availability;
    })
    .catch(() => {
      cachedAvailability = 'NotSupported';
    });
}

function isHealthConnectAvailable(): boolean {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return false;
  }
  startAvailabilityProbe();
  return cachedAvailability === 'Available';
}

/** @internal — exported for tests so they can reset the probe. */
export function __resetHealthConnectAvailability(value: HealthConnectAvailability | null = null): void {
  cachedAvailability = value;
  availabilityProbeStarted = value !== null;
}

/**
 * Force a fresh availability probe and resolve once the cached value is
 * updated. Subsequent synchronous reads of `healthConnectAdapter.isAvailable`
 * will return the correct value.
 *
 * Call this on app mount so the cache is warm by the time the user navigates
 * to the Telemetry / Wearables UI. Without this pre-warm, a user tapping
 * "Connect" within ~50ms of boot can race the probe and see a false negative
 * (the sync getter conservatively returns `false` while the probe is in
 * flight).
 *
 * Safe to call repeatedly — the probe is short-circuited on non-Android
 * platforms, and the underlying `HealthConnect.checkAvailability` call is
 * idempotent.
 *
 * Returns the resolved availability flag (`true` only when Health Connect
 * is installed and reachable on Android). Errors are swallowed — the cache
 * is set to `'NotSupported'` on failure.
 */
export async function preWarmHealthConnect(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    cachedAvailability = 'NotSupported';
    availabilityProbeStarted = true;
    return false;
  }
  availabilityProbeStarted = true;
  try {
    const result = await HealthConnect.checkAvailability();
    cachedAvailability = result.availability;
  } catch {
    cachedAvailability = 'NotSupported';
  }
  return cachedAvailability === 'Available';
}

/**
 * Resolve when the in-flight availability probe completes. Useful for code
 * paths that want to await readiness without forcing a fresh probe — e.g.
 * tests that have already triggered the probe via a `isAvailable` read.
 *
 * If no probe has been started yet, this kicks one off. If the cache is
 * already populated, it resolves immediately.
 */
export async function awaitAvailability(): Promise<boolean> {
  if (cachedAvailability !== null) {
    return cachedAvailability === 'Available';
  }
  return preWarmHealthConnect();
}

export const healthConnectAdapter: HealthAdapter = {
  name: 'health-connect',
  platform: 'capacitor',

  get isAvailable(): boolean {
    return isHealthConnectAvailable();
  },

  /**
   * Request user consent for the listed scopes.
   * Maps to `HealthConnect.requestHealthPermissions({ read, write })`.
   * Guardian-Praeventio is read-only today; we request `write: []`.
   */
  async requestPermissions(scopes: HealthScope[]): Promise<PermissionResult> {
    const recordTypes = Array.from(
      new Set(scopes.flatMap(scopeToRecordTypes)),
    );
    if (recordTypes.length === 0) {
      return { granted: [], denied: scopes };
    }

    const result = await HealthConnect.requestHealthPermissions({
      read: recordTypes,
      write: [],
    });

    // The plugin returns granted permissions as strings of the form
    // "android.permission.health.READ_<TYPE>". Extract the TYPE suffix and
    // map it back to our scope set.
    const grantedScopes = new Set<HealthScope>();
    for (const permission of result.grantedPermissions ?? []) {
      const suffix = permission.split('.').pop() ?? '';
      const stripped = suffix.replace(/^READ_/, '').replace(/^WRITE_/, '');
      // Plugin permissions follow Health Connect naming: "READ_HEART_RATE",
      // "READ_STEPS", "READ_ACTIVE_CALORIES_BURNED", etc. Convert SNAKE_CASE
      // to PascalCase so it matches our `RecordType` names.
      const pascal = stripped
        .toLowerCase()
        .split('_')
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
        .join('');
      // Health Connect's permission name uses "HEART_RATE" but the record
      // type is "HeartRateSeries"; handle that one quirk explicitly.
      const recordType =
        pascal === 'HeartRate' ? 'HeartRateSeries' : pascal;
      const scope = recordTypeToScope(recordType);
      if (scope) grantedScopes.add(scope);
    }

    const granted = scopes.filter((s) => grantedScopes.has(s));
    const denied = scopes.filter((s) => !grantedScopes.has(s));
    return { granted, denied };
  },

  /**
   * Read heart-rate samples in the range.
   * Each `HeartRateSeries` record contains a list of `samples`, so we flatten.
   */
  async readHeartRate(range: HealthDataRange): Promise<HeartRateSample[]> {
    if (!isHealthConnectAvailable()) return [];
    const result = await HealthConnect.readRecords({
      type: 'HeartRateSeries',
      timeRangeFilter: buildRange(range),
    });

    const out: HeartRateSample[] = [];
    for (const record of result.records ?? []) {
      if (record.type !== 'HeartRateSeries') continue;
      for (const sample of record.samples ?? []) {
        out.push({
          timestamp: toDate(sample.time),
          bpm: Math.round(sample.beatsPerMinute),
          source: 'wearable',
        });
      }
    }
    return out;
  },

  /**
   * Read step counts in the range. Each `Steps` record covers a closed
   * `[startTime, endTime]` interval; we bucket under `startTime`.
   */
  async readSteps(range: HealthDataRange): Promise<StepsSample[]> {
    if (!isHealthConnectAvailable()) return [];
    const result = await HealthConnect.readRecords({
      type: 'Steps',
      timeRangeFilter: buildRange(range),
    });

    const out: StepsSample[] = [];
    for (const record of result.records ?? []) {
      if (record.type !== 'Steps') continue;
      out.push({
        date: toDate(record.startTime),
        count: record.count,
        source: 'wearable',
      });
    }
    return out;
  },

  /**
   * Read calorie burn. Health Connect splits active vs total; we surface
   * total as `kcal` and active as the optional `active` field. Basal is
   * not exposed by this plugin version (would need `BasalMetabolicRate`,
   * which is a rate, not an integral, so deferred).
   */
  async readCalories(range: HealthDataRange): Promise<CaloriesSample[]> {
    if (!isHealthConnectAvailable()) return [];
    const filter = buildRange(range);

    const [totalRes, activeRes] = await Promise.all([
      HealthConnect.readRecords({ type: 'TotalCaloriesBurned', timeRangeFilter: filter }),
      HealthConnect.readRecords({ type: 'ActiveCaloriesBurned', timeRangeFilter: filter }),
    ]);

    // Bucket by start-time ISO key so total + active for the same window
    // collapse into a single sample.
    const buckets = new Map<string, CaloriesSample>();
    for (const record of totalRes.records ?? []) {
      if (record.type !== 'TotalCaloriesBurned') continue;
      const date = toDate(record.startTime);
      const key = date.toISOString();
      buckets.set(key, { date, kcal: record.energy.value });
    }
    for (const record of activeRes.records ?? []) {
      if (record.type !== 'ActiveCaloriesBurned') continue;
      const date = toDate(record.startTime);
      const key = date.toISOString();
      const existing = buckets.get(key);
      if (existing) {
        existing.active = record.energy.value;
      } else {
        // Active reported without a matching total — surface kcal as the
        // active value rather than dropping the sample.
        buckets.set(key, { date, kcal: record.energy.value, active: record.energy.value });
      }
    }
    return Array.from(buckets.values());
  },

  /**
   * Read sleep sessions. We pick the dominant stage of each session for
   * `quality` (longest-running stage); detailed per-stage timeseries can
   * be a future enhancement when SleepSample grows a `stages` field.
   */
  async readSleep(range: HealthDataRange): Promise<SleepSample[]> {
    if (!isHealthConnectAvailable()) return [];
    const result = await HealthConnect.readRecords({
      type: 'SleepSession',
      timeRangeFilter: buildRange(range),
    });

    const out: SleepSample[] = [];
    for (const record of result.records ?? []) {
      if (record.type !== 'SleepSession') continue;
      const startTime = toDate(record.startTime);
      const endTime = toDate(record.endTime);
      const durationMin = Math.max(
        0,
        Math.round((endTime.getTime() - startTime.getTime()) / 60_000),
      );
      const dominant = pickDominantStage(record.stages ?? []);
      out.push({
        startTime,
        endTime,
        durationMin,
        quality: dominant != null ? stageNumberToQuality(dominant) : undefined,
      });
    }
    return out;
  },
};

function pickDominantStage(stages: SleepSessionStage[]): number | null {
  if (stages.length === 0) return null;
  const totals = new Map<number, number>();
  for (const s of stages) {
    const ms = toDate(s.endTime).getTime() - toDate(s.startTime).getTime();
    totals.set(s.stage, (totals.get(s.stage) ?? 0) + ms);
  }
  let best: number | null = null;
  let bestMs = -1;
  for (const [stage, ms] of totals.entries()) {
    if (ms > bestMs) {
      bestMs = ms;
      best = stage;
    }
  }
  return best;
}
