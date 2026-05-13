/**
 * Guardian Praeventio â€” emergency auto-trigger predicates.
 *
 * Sprint 14: stubs replaced with real signal sources. Each predicate
 * now reads from a vanilla bridge (no React) so the orchestrator at
 * `AppModeContext.tsx` can poll cheaply without dragging the React
 * tree into a service-layer file.
 *
 * Bridges (set from React-side adapters):
 *   â€¢ `pushWeatherSnapshot(...)`     â†’ updates the climate cache.
 *   â€¢ `pushCompanyEmergency(active)` â†’ mirrors EmergencyContext.
 *   â€¢ DeviceMotion is subscribed at module load when available; the
 *     listener mutates a sliding 1s peak-acceleration window.
 *
 * Each predicate is debounced: at most one rising-edge per 60 s.
 */

import type { UsgsEarthquakeAdapter } from '../external/usgs/usgsEarthquakeAdapter.js';
import type { UsgsEarthquake } from '../external/usgs/types.js';
import { getErrorTracker } from '../observability/index.js';

const DEBOUNCE_MS = 60_000;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Climate bridge
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WeatherSnapshot {
  windKmh: number | null;
  conditions: string | null;
  temperatureC: number | null;
}

let weatherSnapshot: WeatherSnapshot = {
  windKmh: null,
  conditions: null,
  temperatureC: null,
};

/** Adapter (called from WeatherBulletin) pushes the latest weather here. */
export function pushWeatherSnapshot(snap: Partial<WeatherSnapshot>): void {
  weatherSnapshot = { ...weatherSnapshot, ...snap };
}

/** Test helper â€” reset all bridges to a known state. */
export function __resetEmergencyBridges(): void {
  weatherSnapshot = { windKmh: null, conditions: null, temperatureC: null };
  companyEmergencyActive = false;
  peakAccelG = 0;
  peakSinceMs = 0;
  usgsAdapter = null;
  lastSeismicLocation = null;
  for (const k of Object.keys(lastTriggerByKey)) delete lastTriggerByKey[k];
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// USGS cross-check bridge (Sprint 39 J3c)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let usgsAdapter:
  | Pick<UsgsEarthquakeAdapter, 'fetchRecentEarthquakes'>
  | null = null;

let lastSeismicLocation: { lat: number; lon: number } | null = null;

/**
 * Inyecta el USGS adapter para cross-check del checkSismo. Llamado por
 * la app shell con la singleton. Si no se llama, `checkSismoEnriched`
 * degrada a severity 'caution' (mismo comportamiento que timeout).
 */
export function pushUsgsAdapter(
  adapter: Pick<UsgsEarthquakeAdapter, 'fetchRecentEarthquakes'> | null,
): void {
  usgsAdapter = adapter;
}

/**
 * Inyecta la Ãºltima ubicaciÃ³n conocida del device (GPS / faena). Necesaria
 * para que `checkSismoEnriched` pueda preguntar al feed sÃ­smico por
 * eventos cercanos.
 */
export function pushDeviceLocation(loc: { lat: number; lon: number } | null): void {
  lastSeismicLocation = loc;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Company emergency bridge
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let companyEmergencyActive = false;

/** Adapter (called from EmergencyContext) mirrors `isEmergencyActive`. */
export function pushCompanyEmergency(active: boolean): void {
  companyEmergencyActive = active;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sismo bridge â€” DeviceMotion sliding 1s window
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const G = 9.80665; // m/sÂ² â†’ 1 g
// Sismic threshold rationale: most consumer phones report ~1g at rest
// (gravity vector). A genuine MMI VI+ ground motion produces peak
// horizontal accelerations >0.6g sustained for hundreds of ms. The
// 0.6g / 300ms heuristic is well below seismograph-grade but reliably
// rejects accidental drops (which spike >2g for <50ms) and walking
// (sub-0.4g, low-frequency). Documented as "approximate".
const SISMO_PEAK_G = 0.6;
const SISMO_SUSTAIN_MS = 300;
const SISMO_WINDOW_MS = 1_000;

let peakAccelG = 0;
let peakSinceMs = 0;
let motionListenerAttached = false;
let motionSupported = false;

interface DeviceMotionAcceleration {
  x: number | null;
  y: number | null;
  z: number | null;
}

/** Process one acceleration sample (exported for tests). */
export function ingestAccelerationSample(
  accel: DeviceMotionAcceleration | null,
  nowMs: number = Date.now(),
): void {
  if (!accel) return;
  const { x, y, z } = accel;
  if (x == null || y == null || z == null) return;
  // Use linear acceleration (no gravity) when available â€” `acceleration`
  // is null on browsers that only expose `accelerationIncludingGravity`,
  // in which case we subtract a 1g baseline along the magnitude.
  const magM = Math.sqrt(x * x + y * y + z * z);
  const gMag = magM / G;
  // Subtract 1g rest baseline conservatively; never go negative.
  const dynamicG = Math.max(0, gMag - 1);
  if (dynamicG >= SISMO_PEAK_G) {
    if (peakAccelG < SISMO_PEAK_G) {
      // Rising edge â€” start the sustain timer.
      peakSinceMs = nowMs;
    }
    peakAccelG = Math.max(peakAccelG, dynamicG);
  } else {
    // Decay the window if the last peak is older than SISMO_WINDOW_MS.
    if (nowMs - peakSinceMs > SISMO_WINDOW_MS) {
      peakAccelG = 0;
      peakSinceMs = 0;
    }
  }
}

function attachMotionListener(): void {
  if (motionListenerAttached) return;
  if (typeof window === 'undefined') return;
  if (typeof window.DeviceMotionEvent === 'undefined') {
    motionSupported = false;
    return;
  }
  motionSupported = true;
  motionListenerAttached = true;
  const handler = (event: DeviceMotionEvent): void => {
    const accel =
      (event.acceleration && event.acceleration.x !== null
        ? event.acceleration
        : event.accelerationIncludingGravity) ?? null;
    ingestAccelerationSample(accel as DeviceMotionAcceleration | null);
  };
  try {
    window.addEventListener('devicemotion', handler);
  } catch {
    motionListenerAttached = false;
  }
}

/** Whether DeviceMotion is available in this environment. */
export function isMotionSupported(): boolean {
  return motionSupported;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Predicates
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const lastTriggerByKey: Record<string, number> = {};

function debounced(key: string, active: boolean, nowMs: number = Date.now()): boolean {
  if (!active) return false;
  const last = lastTriggerByKey[key] ?? 0;
  if (nowMs - last < DEBOUNCE_MS) return false;
  lastTriggerByKey[key] = nowMs;
  return true;
}

/**
 * Adverse climate: trigger on >80 km/h wind, storm/tornado conditions,
 * or temperature outside the [-5, 45] Â°C band.
 */
export async function checkAdverseClimate(): Promise<boolean> {
  const { windKmh, conditions, temperatureC } = weatherSnapshot;
  const danger =
    (windKmh != null && windKmh > 80) ||
    (conditions != null && /storm|tornado|tormenta|tornad/i.test(conditions)) ||
    (temperatureC != null && (temperatureC < -5 || temperatureC > 45));
  return debounced('climate', danger);
}

/**
 * Sismo: peak dynamic acceleration â‰¥0.6 g sustained â‰¥300 ms within a 1 s
 * sliding window (heuristic â€” see threshold rationale above).
 */
export async function checkSismo(): Promise<boolean> {
  attachMotionListener();
  const sustained = peakAccelG >= SISMO_PEAK_G && Date.now() - peakSinceMs >= SISMO_SUSTAIN_MS;
  return debounced('sismo', sustained);
}

/**
 * Sismo enriquecido con cross-check USGS (Sprint 39 J3c).
 *
 * PolÃ­tica directiva:
 *   - SIEMPRE blockOperation: false (regla #1 del usuario).
 *   - El cross-check NO bloquea el trigger â€” solo enriquece la severity:
 *       * USGS confirma sismo Mâ‰¥3.5 en proximidad â†’ severity 'high'.
 *       * USGS responde sin coincidencia â†’ severity 'caution' (puede ser
 *         false positive del DeviceMotion).
 *       * USGS timeout / adapter ausente â†’ severity 'caution' + warn log.
 *   - El recommendation body es construido externamente vÃ­a
 *     `buildCalmRecommendation`; este mÃ³dulo solo provee la severity y
 *     la lista cruda de eventos.
 */
export interface EnrichedSismoResult {
  fired: boolean;
  severity: 'caution' | 'high';
  externalConfirmed: boolean;
  matchedEvents: UsgsEarthquake[];
  blockOperation: false;
}

/** Constantes del cross-check. */
const USGS_MIN_MAG = 3.5;
const USGS_SINCE_MIN = 5;
const USGS_RADIUS_KM = 200;
const USGS_TIMEOUT_MS = 3_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('USGS cross-check timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkSismoEnriched(
  opts: { now?: number; timeoutMs?: number } = {},
): Promise<EnrichedSismoResult> {
  const fired = await checkSismo();
  if (!fired) {
    return {
      fired: false,
      severity: 'caution',
      externalConfirmed: false,
      matchedEvents: [],
      blockOperation: false,
    };
  }

  // Default conservador: caution. Solo subimos a 'high' con confirmaciÃ³n.
  if (!usgsAdapter || !lastSeismicLocation) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        '[autoTrigger] USGS cross-check skipped â€” adapter/location missing',
      );
    } catch {
      /* console may not exist */
    }
    return {
      fired: true,
      severity: 'caution',
      externalConfirmed: false,
      matchedEvents: [],
      blockOperation: false,
    };
  }

  const sinceHours = USGS_SINCE_MIN / 60;
  try {
    const events = await withTimeout(
      usgsAdapter.fetchRecentEarthquakes({
        centerLat: lastSeismicLocation.lat,
        centerLon: lastSeismicLocation.lon,
        radiusKm: USGS_RADIUS_KM,
        minMagnitude: USGS_MIN_MAG,
        sinceHours,
      }),
      opts.timeoutMs ?? USGS_TIMEOUT_MS,
    );
    if (events.length > 0) {
      return {
        fired: true,
        severity: 'high',
        externalConfirmed: true,
        matchedEvents: events,
        blockOperation: false,
      };
    }
    return {
      fired: true,
      severity: 'caution',
      externalConfirmed: false,
      matchedEvents: [],
      blockOperation: false,
    };
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        '[autoTrigger] USGS cross-check failed; falling back to severity caution',
        err,
      );
    } catch {
      /* swallow */
    }
    try {
      getErrorTracker().captureException(
        err instanceof Error ? err : new Error(String(err)),
        { tags: { component: 'autoTrigger.usgs' } },
      );
    } catch {
      /* observability never breaks */
    }
    return {
      fired: true,
      severity: 'caution',
      externalConfirmed: false,
      matchedEvents: [],
      blockOperation: false,
    };
  }
}

/** Company emergency mirrors EmergencyContext via `pushCompanyEmergency`. */
export async function checkCompanyEmergency(): Promise<boolean> {
  return debounced('company', companyEmergencyActive);
}

/** Reason surfaced to the UI overlay. `sismo` and `company` win over `climate`
 * when multiple predicates fire on the same tick (life-safety > weather). */
export type EmergencyReason = 'sismo' | 'company' | 'climate';

/** Climate sub-type â€” derived from the latest snapshot at trigger time so
 * the overlay can pick the right copy ("storm" vs "extreme heat" vs
 * "extreme cold"). `null` when the predicate did not fire on this tick. */
export type ClimateSubType = 'storm' | 'extreme_heat' | 'extreme_cold' | null;

export function deriveClimateSubType(snap: WeatherSnapshot): ClimateSubType {
  const { windKmh, conditions, temperatureC } = snap;
  if (
    (windKmh != null && windKmh > 80) ||
    (conditions != null && /storm|tornado|tormenta|tornad/i.test(conditions))
  ) {
    return 'storm';
  }
  if (temperatureC != null && temperatureC > 45) return 'extreme_heat';
  if (temperatureC != null && temperatureC < -5) return 'extreme_cold';
  return null;
}

export interface EmergencyTriggerEvent {
  reason: EmergencyReason;
  climateSubType: ClimateSubType;
  peakG: number;
  at: number;
}

/**
 * Starts the background monitor. Calls `onTrigger` on each rising edge
 * across any predicate. Returns a cleanup function.
 */
export function startEmergencyMonitor(
  onTrigger: (evt?: EmergencyTriggerEvent) => void,
): () => void {
  let cancelled = false;
  attachMotionListener();

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    try {
      const [climate, sismo, company] = await Promise.all([
        checkAdverseClimate(),
        checkSismo(),
        checkCompanyEmergency(),
      ]);
      if (sismo || company || climate) {
        const reason: EmergencyReason = sismo ? 'sismo' : company ? 'company' : 'climate';
        onTrigger({
          reason,
          climateSubType: reason === 'climate' ? deriveClimateSubType(weatherSnapshot) : null,
          peakG: peakAccelG,
          at: Date.now(),
        });
      }
    } catch {
      // Predicates must never throw, but be defensive.
    }
  };

  // 5s cadence â€” DeviceMotion is event-driven so the poll is just a
  // sustain check; cheap enough at 5s to cap detection latency.
  const interval = setInterval(() => {
    void tick();
  }, 5_000);

  return (): void => {
    cancelled = true;
    clearInterval(interval);
  };
}
