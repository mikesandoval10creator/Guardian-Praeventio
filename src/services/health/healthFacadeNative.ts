/**
 * Native health facade — Bucket P (Sprint 21 ola 5).
 *
 * Higher-level, simplified API layered on top of the existing per-platform
 * adapters in this folder (`healthKitAdapter`, `healthConnectAdapter`,
 * `googleFitAdapter`, `noopAdapter`). The richer adapter contract in
 * `./types.ts` (sample lists, sleep stages, etc.) is preserved untouched —
 * this module is purely additive and exposes the trimmed-down 4-metric
 * surface the Telemetry/WearablesPanel UI needs:
 *
 *     steps today | heart rate range | active energy | distance walked
 *
 * Selection rules (mirrors `getHealthAdapter()` semantics, but EXCLUDES the
 * deprecated Google Fit fallback — that path is still served by the
 * existing OAuth dance in `Telemetry.tsx` for the web/legacy case):
 *
 *   - Capacitor.isNativePlatform() && getPlatform() === 'ios'     -> HealthKit
 *   - Capacitor.isNativePlatform() && getPlatform() === 'android' -> Health Connect
 *   - Web / unsupported                                            -> noop returns []
 *
 * Distance walked is NOT exposed by either underlying adapter today (see
 * `./types.ts` — only steps/heart/calories/sleep are modeled). We query the
 * plugin SDK directly for distance and gracefully return `[]` if the plugin
 * surface is missing (older plugin versions or web).
 *
 * Test seam: `__setNativePlatformChecker` lets `healthFacadeNative.test.ts`
 * mock `Capacitor.isNativePlatform()` + `getPlatform()` without having to
 * re-mock `@capacitor/core` per test.
 */

import { Capacitor } from '@capacitor/core';
import { CapacitorHealthkit } from '@perfood/capacitor-healthkit';
import { HealthConnect } from '@kiwi-health/capacitor-health-connect';

export type HealthMetric = 'steps' | 'heartRate' | 'activeEnergy' | 'distance';

export interface HealthPermissionResult {
  granted: HealthMetric[];
  denied: HealthMetric[];
}

export interface HeartRatePoint {
  timestamp: number;
  bpm: number;
}

export interface ActiveEnergyPoint {
  timestamp: number;
  kcal: number;
}

export interface DistancePoint {
  timestamp: number;
  meters: number;
}

export interface HealthFacadeNative {
  /** Which native plugin (if any) is backing this facade right now. */
  readonly backend: 'healthkit' | 'health-connect' | 'none';

  /** Open the OS-native authorization sheet for the listed metrics. */
  requestPermissions(metrics: HealthMetric[]): Promise<HealthPermissionResult>;

  /** Total steps for the local day (00:00 -> now). */
  getStepsToday(): Promise<number>;

  /** Heart-rate samples in [rangeStart, rangeEnd] (UTC). */
  getHeartRate(rangeStart: Date, rangeEnd: Date): Promise<HeartRatePoint[]>;

  /** Active-energy-burned samples in [rangeStart, rangeEnd]. */
  getActiveEnergyBurned(
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ActiveEnergyPoint[]>;

  /** Distance-walked samples (meters) in [rangeStart, rangeEnd]. */
  getDistanceWalked(
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<DistancePoint[]>;
}

// -- Test seam ----------------------------------------------------------------
type NativeChecker = () => { isNative: boolean; platform: string };
let nativeChecker: NativeChecker = () => ({
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
});

/** @internal — exported only for tests. */
export function __setNativePlatformChecker(next: NativeChecker | null): void {
  nativeChecker = next ?? (() => ({
    isNative: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform(),
  }));
}

// -- Metric mapping helpers ---------------------------------------------------
function metricToHKSampleNames(metric: HealthMetric): string[] {
  switch (metric) {
    case 'steps':
      return ['stepCount'];
    case 'heartRate':
      return ['heartRate'];
    case 'activeEnergy':
      return ['activeEnergyBurned'];
    case 'distance':
      return ['distanceWalkingRunning'];
    default:
      return [];
  }
}

function metricToHCRecordTypes(metric: HealthMetric): string[] {
  switch (metric) {
    case 'steps':
      return ['Steps'];
    case 'heartRate':
      return ['HeartRateSeries'];
    case 'activeEnergy':
      return ['ActiveCaloriesBurned'];
    case 'distance':
      return ['Distance'];
    default:
      return [];
  }
}

function startOfLocalDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

// -- iOS HealthKit backend ----------------------------------------------------
function buildHealthKitFacade(): HealthFacadeNative {
  return {
    backend: 'healthkit',

    async requestPermissions(metrics) {
      const hkScopes = Array.from(
        new Set(metrics.flatMap(metricToHKSampleNames)),
      );
      if (hkScopes.length === 0) {
        return { granted: [], denied: metrics };
      }
      try {
        await CapacitorHealthkit.requestAuthorization({
          all: [],
          read: hkScopes,
          write: [],
        });
        // Apple's privacy model never tells us per-scope grants — we
        // optimistically report everything granted; empty reads later mean "no
        // data" or "denied" (indistinguishable, by design).
        return { granted: metrics, denied: [] };
      } catch {
        return { granted: [], denied: metrics };
      }
    },

    async getStepsToday() {
      const start = startOfLocalDay();
      const end = new Date();
      try {
        const result = await CapacitorHealthkit.queryHKitSampleType<{
          startDate: string;
          value: number;
        }>({
          sampleName: 'stepCount',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          limit: 1000,
        });
        return (result.resultData ?? []).reduce(
          (sum, r) => sum + (Number.isFinite(r.value) ? r.value : 0),
          0,
        );
      } catch {
        return 0;
      }
    },

    async getHeartRate(rangeStart, rangeEnd) {
      try {
        const result = await CapacitorHealthkit.queryHKitSampleType<{
          startDate: string;
          value: number;
        }>({
          sampleName: 'heartRate',
          startDate: rangeStart.toISOString(),
          endDate: rangeEnd.toISOString(),
          limit: 1000,
        });
        return (result.resultData ?? []).map((r) => ({
          timestamp: new Date(r.startDate).getTime(),
          bpm: Math.round(r.value),
        }));
      } catch {
        return [];
      }
    },

    async getActiveEnergyBurned(rangeStart, rangeEnd) {
      try {
        const result = await CapacitorHealthkit.queryHKitSampleType<{
          startDate: string;
          value: number;
        }>({
          sampleName: 'activeEnergyBurned',
          startDate: rangeStart.toISOString(),
          endDate: rangeEnd.toISOString(),
          limit: 1000,
        });
        return (result.resultData ?? []).map((r) => ({
          timestamp: new Date(r.startDate).getTime(),
          kcal: r.value,
        }));
      } catch {
        return [];
      }
    },

    async getDistanceWalked(rangeStart, rangeEnd) {
      try {
        const result = await CapacitorHealthkit.queryHKitSampleType<{
          startDate: string;
          value: number;
        }>({
          sampleName: 'distanceWalkingRunning',
          startDate: rangeStart.toISOString(),
          endDate: rangeEnd.toISOString(),
          limit: 1000,
        });
        return (result.resultData ?? []).map((r) => ({
          timestamp: new Date(r.startDate).getTime(),
          // HealthKit returns meters for distance samples by default.
          meters: r.value,
        }));
      } catch {
        return [];
      }
    },
  };
}

// -- Android Health Connect backend ------------------------------------------
function buildHealthConnectFacade(): HealthFacadeNative {
  return {
    backend: 'health-connect',

    async requestPermissions(metrics) {
      const recordTypes = Array.from(
        new Set(metrics.flatMap(metricToHCRecordTypes)),
      );
      if (recordTypes.length === 0) {
        return { granted: [], denied: metrics };
      }
      try {
        // Cast: the plugin's RecordType union is narrower than a string at
        // compile time, but accepts our values at runtime. We map back to
        // metrics from the granted-permissions reply.
        const result = await HealthConnect.requestHealthPermissions({
          read: recordTypes as never,
          write: [],
        });
        const grantedRaw = (result?.grantedPermissions ?? []) as string[];
        const grantedMetrics = new Set<HealthMetric>();
        for (const perm of grantedRaw) {
          const suffix = perm.split('.').pop() ?? '';
          const stripped = suffix.replace(/^READ_/, '').replace(/^WRITE_/, '');
          const norm = stripped.toLowerCase();
          if (norm.includes('step')) grantedMetrics.add('steps');
          if (norm.includes('heart')) grantedMetrics.add('heartRate');
          if (norm.includes('active') && norm.includes('calor'))
            grantedMetrics.add('activeEnergy');
          if (norm.includes('distance')) grantedMetrics.add('distance');
        }
        const granted = metrics.filter((m) => grantedMetrics.has(m));
        const denied = metrics.filter((m) => !grantedMetrics.has(m));
        return { granted, denied };
      } catch {
        return { granted: [], denied: metrics };
      }
    },

    async getStepsToday() {
      const start = startOfLocalDay();
      const end = new Date();
      try {
        const result = await HealthConnect.readRecords({
          type: 'Steps',
          timeRangeFilter: { type: 'between', startTime: start, endTime: end },
        });
        let total = 0;
        for (const record of result.records ?? []) {
          if (record.type !== 'Steps') continue;
          const count = Number(record.count);
          if (Number.isFinite(count)) total += count;
        }
        return total;
      } catch {
        return 0;
      }
    },

    async getHeartRate(rangeStart, rangeEnd) {
      try {
        const result = await HealthConnect.readRecords({
          type: 'HeartRateSeries',
          timeRangeFilter: {
            type: 'between',
            startTime: rangeStart,
            endTime: rangeEnd,
          },
        });
        const out: HeartRatePoint[] = [];
        for (const record of result.records ?? []) {
          if (record.type !== 'HeartRateSeries') continue;
          for (const sample of record.samples ?? []) {
            const t = sample.time instanceof Date
              ? sample.time.getTime()
              : new Date(sample.time as unknown as string).getTime();
            out.push({
              timestamp: t,
              bpm: Math.round(sample.beatsPerMinute),
            });
          }
        }
        return out;
      } catch {
        return [];
      }
    },

    async getActiveEnergyBurned(rangeStart, rangeEnd) {
      try {
        const result = await HealthConnect.readRecords({
          type: 'ActiveCaloriesBurned',
          timeRangeFilter: {
            type: 'between',
            startTime: rangeStart,
            endTime: rangeEnd,
          },
        });
        const out: ActiveEnergyPoint[] = [];
        for (const record of result.records ?? []) {
          if (record.type !== 'ActiveCaloriesBurned') continue;
          const t = record.startTime instanceof Date
            ? record.startTime.getTime()
            : new Date(record.startTime as unknown as string).getTime();
          out.push({ timestamp: t, kcal: record.energy?.value ?? 0 });
        }
        return out;
      } catch {
        return [];
      }
    },

    async getDistanceWalked(rangeStart, rangeEnd) {
      try {
        // 'Distance' is a Health Connect record type but the plugin's
        // discriminated union may not include it on older plugin versions.
        // Cast through `never` so the call compiles; if the plugin throws at
        // runtime we surface [] just like a denied permission.
        const result = await HealthConnect.readRecords({
          type: 'Distance' as never,
          timeRangeFilter: {
            type: 'between',
            startTime: rangeStart,
            endTime: rangeEnd,
          },
        });
        const out: DistancePoint[] = [];
        for (const record of (result.records ?? []) as Array<Record<string, unknown>>) {
          const startTime = record.startTime as Date | string | undefined;
          const t = startTime instanceof Date
            ? startTime.getTime()
            : startTime
              ? new Date(startTime).getTime()
              : Date.now();
          const distance = record.distance as { value?: number } | undefined;
          out.push({ timestamp: t, meters: distance?.value ?? 0 });
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

// -- Web / noop backend -------------------------------------------------------
function buildNoopFacade(): HealthFacadeNative {
  return {
    backend: 'none',
    async requestPermissions(metrics) {
      return { granted: [], denied: metrics };
    },
    async getStepsToday() {
      return 0;
    },
    async getHeartRate() {
      return [];
    },
    async getActiveEnergyBurned() {
      return [];
    },
    async getDistanceWalked() {
      return [];
    },
  };
}

/**
 * Pick the right native facade for the current runtime. Web / non-native
 * platforms get the noop facade; the caller (Telemetry.tsx) is responsible
 * for falling back to its existing Web Bluetooth + Google Fit OAuth path.
 */
export function getHealthFacadeNative(): HealthFacadeNative {
  const { isNative, platform } = nativeChecker();
  if (!isNative) return buildNoopFacade();
  if (platform === 'ios') return buildHealthKitFacade();
  if (platform === 'android') return buildHealthConnectFacade();
  return buildNoopFacade();
}
