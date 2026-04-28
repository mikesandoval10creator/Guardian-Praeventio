/**
 * Shared types for the Health data layer.
 *
 * The Guardian-Praeventio app reads worker biometric/activity signals
 * (heart rate, steps, calories, sleep) from a per-platform health adapter:
 *   - Android  -> Health Connect (system app)
 *   - iOS      -> HealthKit (via Capacitor plugin abstraction)
 *   - Web      -> noop (returns empty)
 *   - Legacy   -> Google Fit OAuth (DEPRECATED — sunset 2026; sign-up closed 2024-05-01)
 *
 * This module is intentionally framework-free: it MUST NOT import from
 * `@capacitor/*`, `firebase`, or any browser-only API. Adapters do that.
 */

/** Source of a heart-rate reading. `phone-camera` = on-device PPG. */
export type HeartRateSource = 'wearable' | 'phone-camera' | 'manual';

/** Where a steps/calories sample originated. */
export type ActivitySource = 'wearable' | 'phone' | 'manual';

export interface HeartRateSample {
  /** Instant the BPM reading was taken. UTC. */
  timestamp: Date;
  /** Beats per minute. Integer expected; adapters may pre-round. */
  bpm: number;
  source: HeartRateSource;
}

export interface StepsSample {
  /** Local-day midnight (00:00 in the user's timezone) the count is bucketed under. */
  date: Date;
  /** Step count for that day. */
  count: number;
  source: ActivitySource;
}

export interface CaloriesSample {
  /** Local-day midnight bucket. */
  date: Date;
  /** Total kcal expended (basal + active) when those splits aren't available. */
  kcal: number;
  /** Basal metabolic kcal, if the source distinguishes. */
  basal?: number;
  /** Active kcal (above BMR), if the source distinguishes. */
  active?: number;
}

/** Sleep stage classification. Values follow Health Connect's stage enum. */
export type SleepQuality = 'deep' | 'light' | 'rem' | 'awake';

export interface SleepSample {
  startTime: Date;
  endTime: Date;
  /** Convenience: minutes between start and end. Adapters fill this. */
  durationMin: number;
  quality?: SleepQuality;
}

/** Inclusive [start, end] range used by every read* method. */
export interface HealthDataRange {
  start: Date;
  end: Date;
}

/** Permission scopes the app may request. Mapped per-adapter. */
export type HealthScope =
  | 'heart-rate'
  | 'steps'
  | 'calories'
  | 'sleep'
  | 'body-composition';

export interface PermissionResult {
  granted: HealthScope[];
  denied: HealthScope[];
}

/** Adapter implementation identity. Used by the facade and tests. */
export type HealthAdapterName =
  | 'health-connect'
  | 'healthkit'
  | 'google-fit-deprecated'
  | 'noop';

/** Runtime platform the adapter is intended for. */
export type HealthAdapterPlatform = 'android' | 'ios' | 'web' | 'capacitor';

/**
 * Common interface every health adapter satisfies. The facade in `index.ts`
 * picks one of these at runtime based on platform + plugin availability.
 *
 * Implementations MUST be safe to call on any platform — they return empty
 * arrays or throw a clearly-labeled `NotImplemented`/`NotAvailable` error
 * rather than crashing the app.
 */
export interface HealthAdapter {
  readonly name: HealthAdapterName;
  readonly isAvailable: boolean;
  readonly platform: HealthAdapterPlatform;

  requestPermissions(scopes: HealthScope[]): Promise<PermissionResult>;
  readHeartRate(range: HealthDataRange): Promise<HeartRateSample[]>;
  readSteps(range: HealthDataRange): Promise<StepsSample[]>;
  readCalories(range: HealthDataRange): Promise<CaloriesSample[]>;
  readSleep(range: HealthDataRange): Promise<SleepSample[]>;
}
