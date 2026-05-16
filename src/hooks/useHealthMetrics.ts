/**
 * useHealthMetrics — Bucket OO (Sprint 25).
 *
 * Unified runtime hook for health/fitness telemetry. Sits on top of the
 * Sprint 21 Bucket P `healthFacadeNative` for iOS/Android, and falls back
 * to a "web" source identifier for browsers that the existing Telemetry
 * page wires up via Web Bluetooth + Google Fit OAuth.
 *
 * Source matrix:
 *   - Capacitor isNative + ios       -> 'healthkit'
 *   - Capacitor isNative + android   -> 'health-connect'
 *   - Web (with chrome BLE wired)    -> 'web-bluetooth'
 *   - Web (Google Fit OAuth wired)   -> 'google-fit'
 *   - Otherwise                       -> 'mock'
 *
 * Permission flow:
 *   - Native: requestPermissions invokes the OS sheet via the facade
 *     and caches the granted set in localStorage so we don't re-prompt
 *     each session.
 *   - Web: there is no global permission API; the per-session UI flows
 *     in Telemetry.tsx own that handshake. The hook reports
 *     requestPermissions() === true on web so the consumer can
 *     immediately call syncNow().
 *
 * Auto-sync: when `autoSyncMs` > 0 the hook installs a setInterval that
 * triggers syncNow on every tick. Default: 5 minutes. Set 0 to disable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  getHealthFacadeNative,
  type HealthMetric,
} from '../services/health/healthFacadeNative';

export type HealthSource =
  | 'healthkit'
  | 'health-connect'
  | 'web-bluetooth'
  | 'google-fit'
  | 'mock';

export interface HealthMetrics {
  stepsToday: number | null;
  heartRateRecent: { timestamp: number; bpm: number }[];
  activeEnergyKcal: number | null;
  distanceM: number | null;
  source: HealthSource;
  lastSyncMs: number;
  isLoading: boolean;
  error: string | null;
}

export interface UseHealthMetricsOpts {
  /** Auto-sync interval in ms. 0 disables. Default 5 min. */
  autoSyncMs?: number;
  /**
   * Optional web-source override. The Telemetry page already owns the
   * BLE / Google Fit flows; pass a snapshot here so the hook can report
   * the right source label and surface the data in one place.
   */
  webOverride?: {
    stepsToday?: number | null;
    heartRateBpm?: number | null;
    lastSyncMs?: number;
    source?: 'web-bluetooth' | 'google-fit';
  };
}

export interface UseHealthMetricsReturn extends HealthMetrics {
  syncNow(): Promise<void>;
  requestPermissions(): Promise<boolean>;
}

const DEFAULT_AUTO_SYNC_MS = 5 * 60_000;
const PERM_CACHE_KEY = 'gp.health.permissions.granted';
const REQUESTED_METRICS: HealthMetric[] = [
  'steps',
  'heartRate',
  'activeEnergy',
  'distance',
];

interface PlatformProbe {
  isNative: boolean;
  platform: string;
}

function probePlatform(): PlatformProbe {
  try {
    return {
      isNative: Capacitor.isNativePlatform(),
      platform: Capacitor.getPlatform(),
    };
  } catch {
    return { isNative: false, platform: 'web' };
  }
}

function readCachedGrants(): HealthMetric[] {
  try {
    const raw = globalThis.localStorage?.getItem(PERM_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is HealthMetric =>
        m === 'steps' ||
        m === 'heartRate' ||
        m === 'activeEnergy' ||
        m === 'distance',
    );
  } catch {
    return [];
  }
}

function writeCachedGrants(metrics: HealthMetric[]): void {
  try {
    globalThis.localStorage?.setItem(
      PERM_CACHE_KEY,
      JSON.stringify(metrics),
    );
  } catch {
    /* swallow — non-fatal */
  }
}

export function useHealthMetrics(
  opts: UseHealthMetricsOpts = {},
): UseHealthMetricsReturn {
  const autoSyncMs = opts.autoSyncMs ?? DEFAULT_AUTO_SYNC_MS;

  const probe = probePlatform();
  const initialSource: HealthSource =
    probe.isNative && probe.platform === 'ios'
      ? 'healthkit'
      : probe.isNative && probe.platform === 'android'
        ? 'health-connect'
        : opts.webOverride?.source ??
          (opts.webOverride?.heartRateBpm != null ||
          opts.webOverride?.stepsToday != null
            ? 'web-bluetooth'
            : 'mock');

  const [state, setState] = useState<HealthMetrics>({
    stepsToday: opts.webOverride?.stepsToday ?? null,
    heartRateRecent:
      opts.webOverride?.heartRateBpm != null
        ? [
            {
              timestamp: opts.webOverride.lastSyncMs ?? Date.now(),
              bpm: opts.webOverride.heartRateBpm,
            },
          ]
        : [],
    activeEnergyKcal: null,
    distanceM: null,
    source: initialSource,
    lastSyncMs: opts.webOverride?.lastSyncMs ?? 0,
    isLoading: false,
    error: null,
  });

  // Track latest webOverride in a ref so the syncNow closure reads fresh
  // values even if the interval was set up earlier.
  const overrideRef = useRef(opts.webOverride);
  overrideRef.current = opts.webOverride;

  const syncNow = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    const probeNow = probePlatform();
    try {
      if (probeNow.isNative) {
        const facade = getHealthFacadeNative();
        const now = new Date();
        const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        const cached = readCachedGrants();
        if (cached.length === 0) {
          // Never asked / never cached — skip the heavy reads. The
          // consumer must call requestPermissions() first.
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: 'permissions-not-granted',
          }));
          return;
        }

        const [steps, heartRate, energy, distance] = await Promise.all([
          facade.getStepsToday(),
          facade.getHeartRate(fiveMinAgo, now),
          facade.getActiveEnergyBurned(startOfDay, now),
          facade.getDistanceWalked(startOfDay, now),
        ]);

        const totalKcal = energy.reduce((s, p) => s + (p.kcal || 0), 0);
        const totalMeters = distance.reduce((s, p) => s + (p.meters || 0), 0);

        const source: HealthSource =
          facade.backend === 'healthkit'
            ? 'healthkit'
            : facade.backend === 'health-connect'
              ? 'health-connect'
              : 'mock';

        setState({
          stepsToday: Number.isFinite(steps) ? steps : null,
          heartRateRecent: heartRate,
          activeEnergyKcal: totalKcal || null,
          distanceM: totalMeters || null,
          source,
          lastSyncMs: Date.now(),
          isLoading: false,
          error: null,
        });
        return;
      }

      // Web: defer to the override snapshot supplied by the parent.
      const ov = overrideRef.current;
      const source: HealthSource =
        ov?.source ??
        (ov?.heartRateBpm != null || ov?.stepsToday != null
          ? 'web-bluetooth'
          : 'mock');

      setState({
        stepsToday: ov?.stepsToday ?? null,
        heartRateRecent:
          ov?.heartRateBpm != null
            ? [
                {
                  timestamp: ov.lastSyncMs ?? Date.now(),
                  bpm: ov.heartRateBpm,
                },
              ]
            : [],
        activeEnergyKcal: null,
        distanceM: null,
        source,
        lastSyncMs: ov?.lastSyncMs ?? Date.now(),
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'sync-failed',
      }));
    }
  }, []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const probeNow = probePlatform();
    if (!probeNow.isNative) {
      // The web BLE / Fit handshake lives in Telemetry.tsx — nothing to
      // request from this hook's perspective.
      return true;
    }
    try {
      const facade = getHealthFacadeNative();
      const result = await facade.requestPermissions(REQUESTED_METRICS);
      writeCachedGrants(result.granted);
      if (result.granted.length === 0) {
        setState((prev) => ({
          ...prev,
          error: 'permissions-denied',
        }));
        return false;
      }
      return true;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'permissions-error',
      }));
      return false;
    }
  }, []);

  // React to override changes on the web path so the consumer gets fresh
  // values without manually calling syncNow.
  useEffect(() => {
    if (probePlatform().isNative) return;
    const ov = opts.webOverride;
    if (!ov) return;
    setState((prev) => ({
      ...prev,
      stepsToday: ov.stepsToday ?? prev.stepsToday,
      heartRateRecent:
        ov.heartRateBpm != null
          ? [
              {
                timestamp: ov.lastSyncMs ?? Date.now(),
                bpm: ov.heartRateBpm,
              },
            ]
          : prev.heartRateRecent,
      source:
        ov.source ??
        (ov.heartRateBpm != null || ov.stepsToday != null
          ? 'web-bluetooth'
          : prev.source),
      lastSyncMs: ov.lastSyncMs ?? prev.lastSyncMs,
    }));
  }, [
    opts.webOverride?.stepsToday,
    opts.webOverride?.heartRateBpm,
    opts.webOverride?.lastSyncMs,
    opts.webOverride?.source,
  ]);

  // Auto-sync interval.
  useEffect(() => {
    if (autoSyncMs <= 0) return undefined;
    const id = setInterval(() => {
      void syncNow();
    }, autoSyncMs);
    return () => clearInterval(id);
  }, [autoSyncMs, syncNow]);

  return {
    ...state,
    syncNow,
    requestPermissions,
  };
}
