/**
 * Guardian Praeventio — Sprint 14 EmergencyAutoBridge.
 *
 * Vanilla-JS-bridge component that wires React-side context into the
 * stateless predicates inside `services/emergency/autoTrigger.ts`. The
 * autoTrigger module is intentionally React-free (it is polled from
 * `AppModeContext` via `startEmergencyMonitor`), so we need a bridge that:
 *
 *   • Subscribes to weather (window CustomEvent broadcast by WeatherBulletin)
 *     and pushes snapshots into `pushWeatherSnapshot`.
 *   • Mirrors `useEmergency().isEmergencyActive` â†’ `pushCompanyEmergency`.
 *   • Subscribes to DeviceMotion (browser) or `Capacitor Motion`
 *     (native, when `Capacitor.isNative` is true) â†’ `ingestAccelerationSample`.
 *
 * Mounted from RootLayout; renders nothing.
 *
 * Capacitor note: the `@capacitor/motion` plugin exposes `Motion.addListener
 * ('accel', cb)` returning `{ remove }`. We dynamically import to avoid a
 * hard dependency in environments where the plugin is not installed (the
 * import is wrapped in a try/catch and logged once).
 */

import React, { useEffect } from 'react';
import { useEmergency } from '../../contexts/EmergencyContext';
import {
  ingestAccelerationSample,
  pushCompanyEmergency,
  pushWeatherSnapshot,
  type EmergencyTriggerEvent,
} from '../../services/emergency/autoTrigger';
import { logger } from '../../utils/logger';

// Sprint 32 audit W1 — auto-trigger broadcast from AppModeContext. The
// emergency monitor fires a CustomEvent `gp:emergency-auto-trigger` when
// it detects a sismo/company/climate condition. We listen here, resolve the
// active project from localStorage (the SelectedProjectProvider mirrors it
// under `gp.activeProjectId`), and route the event through
// `triggerEmergency()` so it both writes the Firestore doc and fans out
// via FCM (the server-side `notify-brigada` migration in Sprint 32 P0).
const AUTO_TRIGGER_EVENT = 'gp:emergency-auto-trigger';
const ACTIVE_PROJECT_STORAGE_KEY = 'gp.activeProjectId';

function readActiveProjectId(): string | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  try {
    const raw = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
    return raw && raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

// `WeatherBulletin` already fetches Open-Meteo and renders to its own UI;
// to avoid an invasive context refactor we listen for a CustomEvent named
// `gp:weather-snapshot` that callers can dispatch with `{ windKmh,
// conditions, temperatureC }`. Existing callers that haven't migrated yet
// continue to work — the bridge simply observes nothing.
const WEATHER_EVENT = 'gp:weather-snapshot';

interface WeatherEventDetail {
  windKmh?: number | null;
  conditions?: string | null;
  temperatureC?: number | null;
}

function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  // Capacitor v4+: `Capacitor.isNativePlatform()`. v3 legacy: `isNative`
  // (no longer surfaced via typed PraeventioCapacitorBridge — access
  // through an `unknown` cast for backwards compat with old shells).
  if (cap && typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
  const legacy = cap as unknown as { isNative?: boolean } | undefined;
  return !!legacy?.isNative;
}

export function EmergencyAutoBridge(): React.ReactElement | null {
  const { isEmergencyActive, triggerEmergency } = useEmergency();

  // Mirror EmergencyContext into the company predicate.
  useEffect(() => {
    pushCompanyEmergency(!!isEmergencyActive);
  }, [isEmergencyActive]);

  // Sprint 32 audit W1 — listen for the auto-trigger broadcast from
  // AppModeContext and route it through triggerEmergency(), which writes
  // the Firestore event AND calls /api/emergency/notify-brigada for the
  // FCM fan-out to supervisors. Without this listener the supervisor never
  // got pushed: the auto-monitor only flipped the local UI mode.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (evt: Event): void => {
      const detail = (evt as CustomEvent<EmergencyTriggerEvent>).detail;
      if (!detail) return;
      const reason = detail.reason; // 'sismo' | 'company' | 'climate' | 'fall'
      const projectId = readActiveProjectId();
      // triggerEmergency degrades gracefully when projectId is undefined
      // (it just sets local state without persisting / fanning out). For
      // a worker outside any project context a sismo trigger still flips
      // the UI to emergency mode — the Firestore doc + push only happen
      // when there is an active project to scope the audit row.
      void triggerEmergency(reason, projectId).catch((err) => {
        logger.error('EmergencyAutoBridge: triggerEmergency failed', { err, reason });
      });
    };
    window.addEventListener(AUTO_TRIGGER_EVENT, handler);
    return () => window.removeEventListener(AUTO_TRIGGER_EVENT, handler);
  }, [triggerEmergency]);

  // Weather: listen for app-wide CustomEvent dispatches.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (evt: Event): void => {
      const detail = (evt as CustomEvent<WeatherEventDetail>).detail ?? {};
      pushWeatherSnapshot({
        windKmh: detail.windKmh ?? null,
        conditions: detail.conditions ?? null,
        temperatureC: detail.temperatureC ?? null,
      });
    };
    window.addEventListener(WEATHER_EVENT, handler);
    return () => window.removeEventListener(WEATHER_EVENT, handler);
  }, []);

  // Acceleration: prefer Capacitor Motion plugin on native; fall back to
  // `DeviceMotionEvent` (which autoTrigger.ts also attaches internally —
  // attaching a second listener is idempotent at the predicate level
  // because samples are time-windowed).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cleanup: (() => void) | null = null;

    if (isCapacitorNative()) {
      // Dynamic import to avoid bundling the plugin where it isn't installed.
      (async () => {
        try {
          const mod = await import('@capacitor/motion');
          const Motion = mod?.Motion;
          if (!Motion?.addListener) return;
          const sub = await Motion.addListener('accel', (evt: any) => {
            ingestAccelerationSample({
              x: evt?.acceleration?.x ?? null,
              y: evt?.acceleration?.y ?? null,
              z: evt?.acceleration?.z ?? null,
            });
          });
          cleanup = (): void => {
            try {
              sub?.remove?.();
            } catch {
              /* noop */
            }
          };
        } catch (err) {
          logger.warn('EmergencyAutoBridge: Capacitor Motion unavailable; falling back to DeviceMotion', { err });
        }
      })();
    } else if (typeof window.DeviceMotionEvent !== 'undefined') {
      const handler = (event: DeviceMotionEvent): void => {
        const accel =
          (event.acceleration && event.acceleration.x !== null
            ? event.acceleration
            : event.accelerationIncludingGravity) ?? null;
        if (!accel) return;
        ingestAccelerationSample({
          x: accel.x ?? null,
          y: accel.y ?? null,
          z: accel.z ?? null,
        });
      };
      window.addEventListener('devicemotion', handler);
      cleanup = (): void => window.removeEventListener('devicemotion', handler);
    }

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return null;
}

export default EmergencyAutoBridge;
