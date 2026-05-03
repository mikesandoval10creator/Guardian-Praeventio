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
 *   • Mirrors `useEmergency().isEmergencyActive` → `pushCompanyEmergency`.
 *   • Subscribes to DeviceMotion (browser) or `Capacitor Motion`
 *     (native, when `Capacitor.isNative` is true) → `ingestAccelerationSample`.
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
} from '../../services/emergency/autoTrigger';
import { logger } from '../../utils/logger';

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
  const cap = (window as any).Capacitor;
  // Capacitor v4+: `Capacitor.isNativePlatform()`. v3: `isNative`.
  if (cap && typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
  return !!cap?.isNative;
}

export function EmergencyAutoBridge(): React.ReactElement | null {
  const { isEmergencyActive } = useEmergency();

  // Mirror EmergencyContext into the company predicate.
  useEffect(() => {
    pushCompanyEmergency(!!isEmergencyActive);
  }, [isEmergencyActive]);

  // Weather: listen for app-wide CustomEvent dispatches.
  useEffect(() => {
    if (typeof window === 'undefined') return;
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
    if (typeof window === 'undefined') return;
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
    } else if (typeof (window as any).DeviceMotionEvent !== 'undefined') {
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
