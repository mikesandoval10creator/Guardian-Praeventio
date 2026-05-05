/**
 * Native Health Adapter — Sprint 30 Bucket HH (audit close-out).
 *
 * Thin, shift-aware wrapper layered on top of `healthFacadeNative` that:
 *
 *   1. Routes Android -> Health Connect, iOS -> HealthKit, web/other -> noop.
 *   2. Enforces ADR 0010 (Privacy by Design / ShiftWindow): every sample
 *      timestamp is checked against the active `ShiftWindow` BEFORE being
 *      returned. Out-of-shift data is dropped silently — the worker's life
 *      outside faena is not the company's business.
 *   3. Exposes a trimmed-down 3+1 metric surface tuned for the
 *      WearablesPanel real-time poll (steps today, latest HR, active kcal
 *      today, optional sleep when explicitly opted-in).
 *   4. Is dependency-injectable: tests can pass a stub facade + plugin via
 *      the optional `deps` argument so we never have to mock module-level
 *      imports.
 *
 * Why not extend `healthFacadeNative` directly? The existing facade is
 * intentionally framework-free and shift-agnostic — it answers raw
 * "what does the OS say?" questions. The ShiftWindow guard is a
 * Praeventio-specific business rule and belongs in a higher layer so the
 * lower layer stays reusable for unit tests, fixtures, and future
 * non-shift contexts (e.g. HealthVaultShare exports the worker
 * personally authorizes outside faena).
 */

import {
  getHealthFacadeNative,
  type HealthFacadeNative,
  type HealthMetric,
} from './healthFacadeNative';
import {
  isTimestampInShift,
  type ShiftWindow,
} from './shiftWindow';

/**
 * Subset of HealthMetric the WearablesPanel polls in real time. Sleep is
 * deliberately NOT in the default scope set — workers must opt-in
 * explicitly per ADR 0010 (sleep can leak shift-end timing, fatigue
 * states, off-duty private info).
 */
export type HealthScope =
  | 'steps'
  | 'heart_rate'
  | 'active_calories'
  | 'sleep';

const SCOPE_TO_METRIC: Record<HealthScope, HealthMetric | null> = {
  steps: 'steps',
  heart_rate: 'heartRate',
  active_calories: 'activeEnergy',
  // 'sleep' has no equivalent in the trimmed HealthFacadeNative surface.
  // Sleep flows through the richer adapters in `index.ts`; we surface
  // null here so the caller sees an explicit "not supported on this
  // path" rather than silently mapping it to something else.
  sleep: null,
};

export interface NativeHealthAdapterDeps {
  /** Override the underlying facade (testing). */
  facade?: HealthFacadeNative;
  /** Override the shift-window source (testing — mostly synchronous). */
  shiftProvider?: () => ShiftWindow | null;
  /** Override `Date.now()` (testing). */
  now?: () => number;
}

export interface NativeHealthAdapter {
  readonly backend: 'healthkit' | 'health-connect' | 'none';
  initNativeHealth(): Promise<boolean>;
  requestPermissions(scopes: HealthScope[]): Promise<boolean>;
  getStepsToday(): Promise<number | null>;
  getHeartRateLatest(): Promise<{ timestamp: number; bpm: number } | null>;
  getActiveCaloriesToday(): Promise<number | null>;
}

/**
 * Build a NativeHealthAdapter. Pass `deps` to inject a fake facade /
 * shift / clock for tests; production callers leave `deps` empty.
 */
export function createNativeHealthAdapter(
  deps: NativeHealthAdapterDeps = {},
): NativeHealthAdapter {
  const facade = deps.facade ?? getHealthFacadeNative();
  const getShift = deps.shiftProvider ?? (() => null);
  const now = deps.now ?? (() => Date.now());

  /**
   * Map our public scope set down to the facade's metric set, dropping
   * scopes that aren't supported on this surface (e.g. sleep).
   */
  function scopesToMetrics(scopes: HealthScope[]): HealthMetric[] {
    const out = new Set<HealthMetric>();
    for (const s of scopes) {
      const m = SCOPE_TO_METRIC[s];
      if (m) out.add(m);
    }
    return Array.from(out);
  }

  return {
    get backend() {
      return facade.backend;
    },

    async initNativeHealth(): Promise<boolean> {
      // No global "init" call exists for either plugin — both come up
      // implicitly on first use. We surface `true` for every supported
      // backend and `false` only when the facade explicitly reports
      // 'none' (web / unsupported).
      return facade.backend !== 'none';
    },

    async requestPermissions(scopes: HealthScope[]): Promise<boolean> {
      const metrics = scopesToMetrics(scopes);
      if (metrics.length === 0) return false;
      try {
        const result = await facade.requestPermissions(metrics);
        return result.granted.length > 0;
      } catch {
        // ADR 0010 — never crash the host app on a permission flow
        // failure; the worker's screen must keep working even if the
        // OS sheet errors out.
        return false;
      }
    },

    async getStepsToday(): Promise<number | null> {
      if (facade.backend === 'none') return null;
      const shift = getShift();
      if (!shift) return null;
      try {
        // The facade returns a daily total. We can't filter individual
        // sub-day samples, so we gate the whole reading on whether
        // "now" is currently inside a shift. Out-of-shift -> null.
        if (!isTimestampInShift(shift, now())) return null;
        const total = await facade.getStepsToday();
        return Number.isFinite(total) ? total : null;
      } catch {
        return null;
      }
    },

    async getHeartRateLatest(): Promise<
      { timestamp: number; bpm: number } | null
    > {
      if (facade.backend === 'none') return null;
      const shift = getShift();
      if (!shift) return null;
      try {
        // Pull the last 5 minutes of HR samples and pick the most recent
        // one that falls inside the shift window. We deliberately query
        // a wider band than we'll return so an early sample doesn't
        // starve us when the user just clocked in.
        const nowMs = now();
        const start = new Date(Math.max(shift.startMs, nowMs - 5 * 60_000));
        const end = new Date(Math.min(shift.endMs, nowMs));
        if (end.getTime() <= start.getTime()) return null;
        const samples = await facade.getHeartRate(start, end);
        // ADR 0010 final-line guard: even though we constrained the
        // query, plugins occasionally return out-of-band samples (e.g.
        // a sample with a timestamp a few seconds outside the range
        // due to OS bucketing). Filter again.
        const inShift = samples.filter((s) =>
          isTimestampInShift(shift, s.timestamp),
        );
        if (inShift.length === 0) return null;
        let latest = inShift[0];
        for (const s of inShift) {
          if (s.timestamp > latest.timestamp) latest = s;
        }
        return { timestamp: latest.timestamp, bpm: latest.bpm };
      } catch {
        return null;
      }
    },

    async getActiveCaloriesToday(): Promise<number | null> {
      if (facade.backend === 'none') return null;
      const shift = getShift();
      if (!shift) return null;
      try {
        const nowMs = now();
        const startOfDay = new Date(nowMs);
        startOfDay.setHours(0, 0, 0, 0);
        // Clamp to the shift — never count calories burned before
        // clock-in even if today started earlier (ADR 0010).
        const start = new Date(Math.max(startOfDay.getTime(), shift.startMs));
        const end = new Date(Math.min(nowMs, shift.endMs));
        if (end.getTime() <= start.getTime()) return null;
        const samples = await facade.getActiveEnergyBurned(start, end);
        const inShift = samples.filter((s) =>
          isTimestampInShift(shift, s.timestamp),
        );
        if (inShift.length === 0) return null;
        const total = inShift.reduce(
          (sum, p) => sum + (Number.isFinite(p.kcal) ? p.kcal : 0),
          0,
        );
        return total;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Convenience singleton for the default production wiring. Tests should
 * prefer `createNativeHealthAdapter({ facade, shiftProvider })` so they
 * stay isolated from module-level state.
 */
let _default: NativeHealthAdapter | null = null;
export function getNativeHealthAdapter(): NativeHealthAdapter {
  if (!_default) _default = createNativeHealthAdapter();
  return _default;
}

/** @internal — exported only for tests so they can reset the singleton. */
export function __resetNativeHealthAdapter(): void {
  _default = null;
}
