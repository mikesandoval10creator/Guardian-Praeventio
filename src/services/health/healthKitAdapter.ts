/**
 * iOS HealthKit adapter — REAL implementation (Round 3 phase 1).
 *
 * Backed by `@perfood/capacitor-healthkit@^1.3.2` (last published 2025-02-13).
 * The plugin is iOS-only at runtime; on Android/web `isAvailable` returns
 * `false` and the facade falls through to `healthConnectAdapter` /
 * `googleFitAdapter` / `noopAdapter`.
 *
 * Plugin API mapping (see `node_modules/@perfood/capacitor-healthkit/dist/esm/definitions.d.ts`):
 *   - HeartRate     -> sampleName `'heartRate'`        (OtherData, value=bpm)
 *   - Steps         -> sampleName `'stepCount'`        (OtherData, value=count)
 *   - Active kcal   -> sampleName `'activeEnergyBurned'` (OtherData)
 *   - Basal kcal    -> sampleName `'basalEnergyBurned'`  (OtherData)
 *   - Sleep         -> sampleName `'sleepAnalysis'`    (SleepData, sleepState string)
 *
 * HealthKit's privacy model intentionally does NOT expose per-scope
 * granted/denied state to the app — Apple's design treats that information
 * as itself sensitive. We therefore optimistically return `granted: scopes`
 * after a successful `requestAuthorization` call; downstream code must
 * tolerate empty result sets as "user said no" (the same shape it gets when
 * the user genuinely has no data for the range).
 *
 * Native iOS config still required (NOT done in this adapter — see
 * HEALTH_CONNECT_MIGRATION.md):
 *   - Xcode: enable HealthKit capability + entitlement.
 *   - `ios/App/App/Info.plist`:
 *       NSHealthShareUsageDescription  (required)
 *       NSHealthUpdateUsageDescription (only if we ever write data)
 *   - `npx cap sync ios` after the manifest edits.
 */

import { Capacitor } from '@capacitor/core';
import { CapacitorHealthkit } from '@perfood/capacitor-healthkit';
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

/** Sample-name strings the plugin accepts. Mirrors the SampleNames enum. */
const HK_SAMPLE = {
  HEART_RATE: 'heartRate',
  STEP_COUNT: 'stepCount',
  ACTIVE_ENERGY_BURNED: 'activeEnergyBurned',
  BASAL_ENERGY_BURNED: 'basalEnergyBurned',
  SLEEP_ANALYSIS: 'sleepAnalysis',
  WEIGHT: 'weight',
  BODY_FAT: 'bodyFat',
} as const;

/** Map our scopes to HealthKit sample names for `requestAuthorization`. */
function scopeToHealthKitTypes(scope: HealthScope): string[] {
  switch (scope) {
    case 'heart-rate':
      return [HK_SAMPLE.HEART_RATE];
    case 'steps':
      return [HK_SAMPLE.STEP_COUNT];
    case 'calories':
      return [HK_SAMPLE.ACTIVE_ENERGY_BURNED, HK_SAMPLE.BASAL_ENERGY_BURNED];
    case 'sleep':
      return [HK_SAMPLE.SLEEP_ANALYSIS];
    case 'body-composition':
      return [HK_SAMPLE.WEIGHT, HK_SAMPLE.BODY_FAT];
    default:
      return [];
  }
}

/** Plugin's BaseData uses ISO strings for startDate/endDate. */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date(NaN);
}

/**
 * HealthKit's `sleepAnalysis` returns `sleepState` as one of:
 *   'inBed' | 'asleep' | 'awake' | 'core' | 'deep' | 'rem' | 'unspecified'
 * iOS 16+ adds 'core'/'deep'/'rem' as the granular stages; older OS lumps
 * everything into 'asleep'. Normalize to our four-bucket SleepQuality.
 */
function sleepStateToQuality(sleepState: string): SleepQuality | undefined {
  const s = (sleepState ?? '').toLowerCase();
  if (s.includes('deep')) return 'deep';
  if (s.includes('rem')) return 'rem';
  if (s.includes('core') || s.includes('asleep') || s.includes('inbed')) return 'light';
  if (s.includes('awake')) return 'awake';
  return undefined;
}

class HealthKitAdapter implements HealthAdapter {
  readonly name = 'healthkit' as const;
  readonly platform = 'capacitor' as const;

  /**
   * iOS-only. We don't probe HKHealthStore.isHealthDataAvailable() here
   * because the getter must be synchronous; gating on the platform check
   * is sufficient — HealthKit is shipped on every iOS device since iOS 8.
   */
  get isAvailable(): boolean {
    try {
      return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
    } catch {
      return false;
    }
  }

  /**
   * Open the HealthKit authorization sheet for the requested scopes.
   *
   * Apple's privacy model: the OS does NOT tell us which sample types the
   * user granted/denied. The plugin promise resolves the moment the sheet
   * dismisses, regardless of choice. We optimistically report every scope
   * as `granted`; reads will surface empty arrays for denied types, which
   * the UI must already handle (a wearable might simply have no data).
   */
  async requestPermissions(scopes: HealthScope[]): Promise<PermissionResult> {
    const hkScopes = Array.from(new Set(scopes.flatMap(scopeToHealthKitTypes)));
    if (hkScopes.length === 0) {
      return { granted: [], denied: scopes };
    }
    try {
      await CapacitorHealthkit.requestAuthorization({
        all: [],
        read: hkScopes,
        write: [],
      });
      return { granted: scopes, denied: [] };
    } catch {
      return { granted: [], denied: scopes };
    }
  }

  async readHeartRate({ start, end }: HealthDataRange): Promise<HeartRateSample[]> {
    if (!this.isAvailable) return [];
    try {
      const result = await CapacitorHealthkit.queryHKitSampleType<{
        startDate: string;
        value: number;
      }>({
        sampleName: HK_SAMPLE.HEART_RATE,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: 1000,
      });
      return (result.resultData ?? []).map((r) => ({
        timestamp: toDate(r.startDate),
        bpm: Math.round(r.value),
        source: 'wearable' as const,
      }));
    } catch {
      return [];
    }
  }

  async readSteps({ start, end }: HealthDataRange): Promise<StepsSample[]> {
    if (!this.isAvailable) return [];
    try {
      const result = await CapacitorHealthkit.queryHKitSampleType<{
        startDate: string;
        value: number;
      }>({
        sampleName: HK_SAMPLE.STEP_COUNT,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: 1000,
      });
      return (result.resultData ?? []).map((r) => ({
        date: toDate(r.startDate),
        count: Math.round(r.value),
        source: 'wearable' as const,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Read calorie burn. HealthKit splits active vs basal cleanly; we emit one
   * sample per active record and attach the basal value for the same start
   * timestamp when one is present.
   */
  async readCalories({ start, end }: HealthDataRange): Promise<CaloriesSample[]> {
    if (!this.isAvailable) return [];
    try {
      const range = {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: 1000,
      };
      const [activeRes, basalRes] = await Promise.all([
        CapacitorHealthkit.queryHKitSampleType<{ startDate: string; value: number }>({
          ...range,
          sampleName: HK_SAMPLE.ACTIVE_ENERGY_BURNED,
        }),
        CapacitorHealthkit.queryHKitSampleType<{ startDate: string; value: number }>({
          ...range,
          sampleName: HK_SAMPLE.BASAL_ENERGY_BURNED,
        }),
      ]);

      const buckets = new Map<string, CaloriesSample>();
      for (const r of activeRes.resultData ?? []) {
        const date = toDate(r.startDate);
        const key = date.toISOString();
        buckets.set(key, { date, kcal: r.value, active: r.value });
      }
      for (const r of basalRes.resultData ?? []) {
        const date = toDate(r.startDate);
        const key = date.toISOString();
        const existing = buckets.get(key);
        if (existing) {
          existing.basal = r.value;
          existing.kcal = (existing.active ?? 0) + r.value;
        } else {
          buckets.set(key, { date, kcal: r.value, basal: r.value });
        }
      }
      return Array.from(buckets.values());
    } catch {
      return [];
    }
  }

  async readSleep({ start, end }: HealthDataRange): Promise<SleepSample[]> {
    if (!this.isAvailable) return [];
    try {
      const result = await CapacitorHealthkit.queryHKitSampleType<{
        startDate: string;
        endDate: string;
        sleepState: string;
      }>({
        sampleName: HK_SAMPLE.SLEEP_ANALYSIS,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: 1000,
      });
      return (result.resultData ?? []).map((r) => {
        const startTime = toDate(r.startDate);
        const endTime = toDate(r.endDate);
        const durationMin = Math.max(
          0,
          Math.round((endTime.getTime() - startTime.getTime()) / 60_000),
        );
        return {
          startTime,
          endTime,
          durationMin,
          quality: sleepStateToQuality(r.sleepState),
        };
      });
    } catch {
      return [];
    }
  }
}

export const healthKitAdapter: HealthAdapter = new HealthKitAdapter();
