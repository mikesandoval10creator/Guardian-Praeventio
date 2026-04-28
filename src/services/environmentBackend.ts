import admin from "firebase-admin";
import type { ClimateForecastDay } from './zettelkasten/climateRiskCoupling';

// Re-export ClimateForecastDay for callers that already import it via this
// module (server.ts dynamic import + future API consumers). Authoritative
// definition lives in `zettelkasten/climateRiskCoupling.ts` — we just
// re-publish it here so the surface of `environmentBackend` is self-contained.
export type { ClimateForecastDay } from './zettelkasten/climateRiskCoupling';

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

// Default location: Santiago de Chile. Per-tenant overrides are a follow-up
// (see TODO at bottom of file).
const DEFAULT_LAT = -33.4489;
const DEFAULT_LON = -70.6693;

export const updateGlobalEnvironmentalContext = async () => {
  const db = admin.firestore();
  const contextRef = db.collection('global_context').doc('environment');

  try {
    const lat = DEFAULT_LAT;
    const lon = DEFAULT_LON;

    // 1. Fetch Weather
    let weatherData = null;
    if (OPENWEATHER_API_KEY) {
      const weatherRes = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`
      );
      if (weatherRes.ok) {
        const data = await weatherRes.json();
        weatherData = {
          temp: Math.round(data.main.temp),
          condition: data.weather[0]?.description || 'Despejado',
          humidity: data.main.humidity,
          windSpeed: data.wind.speed * 3.6,
          location: data.name,
          timestamp: Date.now()
        };
      }
    }

    // 2. Fetch Seismic
    let seismicData = null;
    const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const seismicRes = await fetch(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=500&starttime=${startTime}&minmagnitude=3.0&limit=1&orderby=magnitude`
    );
    if (seismicRes.ok) {
      const data = await seismicRes.json();
      if (data.features && data.features.length > 0) {
        const quake = data.features[0];
        const mag = quake.properties.mag;
        let alertLevel = 'green';
        if (mag >= 6.0) alertLevel = 'red';
        else if (mag >= 5.0) alertLevel = 'orange';
        else if (mag >= 4.0) alertLevel = 'yellow';

        seismicData = {
          magnitude: mag,
          location: quake.properties.place,
          time: quake.properties.time,
          alertLevel
        };
      }
    }

    // 3. Update Firestore
    await contextRef.set({
      weather: weatherData,
      seismic: seismicData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log("[EnvironmentBackend] Global environmental context updated.");
  } catch (error) {
    console.error("[EnvironmentBackend] Error updating context:", error);
  }
};

/* -------------------------------------------------------------------------- */
/* getForecast — multi-day climate forecast                                    */
/* -------------------------------------------------------------------------- */

/**
 * Map of OpenWeather "main" weather group IDs to our ClimateForecastDay
 * conditionCode. Reference: https://openweathermap.org/weather-conditions
 *   - 2xx: thunderstorm  → 'stormy'
 *   - 3xx: drizzle       → 'rainy'
 *   - 5xx: rain          → 'rainy'
 *   - 6xx: snow          → 'snow'
 *   - 7xx: atmosphere (mist/fog/dust) → 'sunny' (no risk uplift; fog handled
 *          via reduced-visibility elsewhere when we have a visibility metric)
 *   - 800: clear         → 'sunny'
 *   - 80x: clouds        → 'sunny' (benign for our risk taxonomy)
 *
 * Heat / cold / wind promotions are applied AFTER aggregation, based on the
 * day's max temperature and max windKmh.
 */
function mapWeatherIdToBaseCondition(id: number): ClimateForecastDay['conditionCode'] {
  if (id >= 200 && id < 300) return 'stormy';
  if (id >= 300 && id < 400) return 'rainy'; // drizzle ≈ rain for our risk model
  if (id >= 500 && id < 600) return 'rainy';
  if (id >= 600 && id < 700) return 'snow';
  if (id >= 700 && id < 800) return 'sunny'; // atmosphere → benign default
  if (id === 800) return 'sunny';
  if (id > 800 && id < 900) return 'sunny'; // clouds → benign
  return 'sunny';
}

/**
 * Worst-case ranking for ClimateForecastDay.conditionCode. Higher = riskier.
 * When aggregating 3-hour buckets into a single per-day value, we keep the
 * one with the highest rank (i.e. one stormy step poisons the whole day).
 *
 * Note: 'extreme-heat', 'cold-snap' and 'windy' are NOT produced by the
 * weather-id mapping — they emerge from temperature/wind promotions after
 * aggregation. We rank them here anyway so the function stays sound if a
 * future weather-id branch starts emitting them directly.
 */
const CONDITION_SEVERITY: Record<ClimateForecastDay['conditionCode'], number> = {
  sunny: 0,
  snow: 1,
  'extreme-heat': 2,
  'cold-snap': 3,
  windy: 4,
  rainy: 5,
  stormy: 6,
};

interface OWForecastItem {
  dt: number; // UTC unix seconds
  main?: { temp?: number };
  weather?: Array<{ id?: number }>;
  wind?: { speed?: number }; // m/s
  rain?: { '3h'?: number }; // mm
  snow?: { '3h'?: number }; // mm
}

interface OWForecastResponse {
  list?: OWForecastItem[];
  city?: { timezone?: number };
}

interface DayBucket {
  dateKey: string; // YYYY-MM-DD in UTC
  date: Date;      // 00:00 UTC of that day
  baseCondition: ClimateForecastDay['conditionCode']; // worst-case from weather IDs
  maxTemp: number;
  maxWindKmh: number;
  precipMm: number;
  hasWind: boolean;
  hasPrecip: boolean;
  hasTemp: boolean;
}

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Aggregate OpenWeather 3-hour-step items into per-day buckets keyed by UTC
 * date. Day-aggregation rules (pinned by environmentBackend.test.ts):
 *   - conditionCode: worst-case across the day's items (CONDITION_SEVERITY).
 *   - temperatureC:  MAX across the day (worst-case for heat-stress checks).
 *   - windKmh:       MAX across the day, m/s → km/h (×3.6).
 *   - precipMm:      SUM across the day (rain[3h] + snow[3h]).
 */
function aggregateByDay(items: OWForecastItem[]): DayBucket[] {
  const byKey = new Map<string, DayBucket>();
  for (const it of items) {
    if (typeof it.dt !== 'number') continue;
    const date = new Date(it.dt * 1000);
    const key = utcDateKey(date);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        dateKey: key,
        date: utcMidnight(date),
        baseCondition: 'sunny',
        maxTemp: -Infinity,
        maxWindKmh: -Infinity,
        precipMm: 0,
        hasWind: false,
        hasPrecip: false,
        hasTemp: false,
      };
      byKey.set(key, bucket);
    }

    const wid = it.weather?.[0]?.id;
    if (typeof wid === 'number') {
      const cond = mapWeatherIdToBaseCondition(wid);
      if (CONDITION_SEVERITY[cond] > CONDITION_SEVERITY[bucket.baseCondition]) {
        bucket.baseCondition = cond;
      }
    }

    const t = it.main?.temp;
    if (typeof t === 'number') {
      bucket.hasTemp = true;
      if (t > bucket.maxTemp) bucket.maxTemp = t;
    }

    const ws = it.wind?.speed;
    if (typeof ws === 'number') {
      bucket.hasWind = true;
      const kmh = ws * 3.6;
      if (kmh > bucket.maxWindKmh) bucket.maxWindKmh = kmh;
    }

    const r = it.rain?.['3h'];
    const s = it.snow?.['3h'];
    if (typeof r === 'number') {
      bucket.hasPrecip = true;
      bucket.precipMm += r;
    }
    if (typeof s === 'number') {
      bucket.hasPrecip = true;
      bucket.precipMm += s;
    }
  }

  // Sorted by dateKey (lexicographic on YYYY-MM-DD == chronological).
  return Array.from(byKey.values()).sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey),
  );
}

/**
 * Apply temperature/wind promotions to the base weather-id condition, in this
 * order (most severe wins, but we already keep the higher-severity weather id
 * via the bucket aggregation):
 *   - if base is 'sunny' (or any non-precip benign code) and maxWindKmh ≥ 40,
 *     promote to 'windy'.
 *   - if base is 'sunny' and maxTemp ≥ 35, promote to 'extreme-heat'.
 *   - if base is 'sunny' and maxTemp ≤ 0,  promote to 'cold-snap'.
 *
 * We deliberately do NOT downgrade 'rainy'/'stormy'/'snow' to wind/heat/cold —
 * a rainy windy day is still 'rainy' (rain risk dominates for our taxonomy).
 */
function promoteByExtremes(bucket: DayBucket): ClimateForecastDay['conditionCode'] {
  let cond = bucket.baseCondition;
  if (cond === 'sunny') {
    if (bucket.hasWind && bucket.maxWindKmh >= 40) cond = 'windy';
    else if (bucket.hasTemp && bucket.maxTemp >= 35) cond = 'extreme-heat';
    else if (bucket.hasTemp && bucket.maxTemp <= 0) cond = 'cold-snap';
  }
  return cond;
}

function bucketToForecastDay(bucket: DayBucket): ClimateForecastDay {
  const conditionCode = promoteByExtremes(bucket);
  const out: ClimateForecastDay = {
    date: bucket.date,
    conditionCode,
    temperatureC: bucket.hasTemp ? Math.round(bucket.maxTemp * 10) / 10 : 0,
  };
  if (bucket.hasWind) {
    out.windKmh = Math.round(bucket.maxWindKmh * 10) / 10;
  }
  if (bucket.hasPrecip) {
    out.precipMm = Math.round(bucket.precipMm * 100) / 100;
  }
  return out;
}

export interface ForecastLocation {
  lat: number;
  lng: number;
}

/**
 * Tenant context discriminator. When passed to {@link getForecast} we look up
 * the tenant's primary site coordinates via {@link resolveTenantLocation}.
 */
export interface TenantLocationContext {
  tenantId: string;
}

/** Type guard separating raw `{lat,lng}` from `{tenantId}` selectors. */
function isTenantContext(
  loc: ForecastLocation | TenantLocationContext | undefined,
): loc is TenantLocationContext {
  return !!loc && typeof (loc as TenantLocationContext).tenantId === 'string';
}

/**
 * Resolve a tenant's primary-site coordinates from Firestore. Reads
 * `tenants/{tenantId}` and returns `data.primarySite.coords` when both
 * `lat` and `lng` are finite numbers.
 *
 * Returns `null` when:
 *   - the tenant doc does not exist,
 *   - the doc has no `primarySite.coords`,
 *   - the coords are not finite numbers,
 *   - any Firestore error occurs (the error is logged and swallowed so the
 *     forecast endpoint can degrade gracefully to the Santiago default).
 *
 * Exported for direct test override via `setTenantLocationResolver`.
 */
export async function resolveTenantLocation(
  tenantId: string,
): Promise<ForecastLocation | null> {
  if (!tenantId || typeof tenantId !== 'string') return null;
  try {
    const db = admin.firestore();
    const snap = await db.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return null;
    const data = snap.data() as
      | { primarySite?: { coords?: { lat?: unknown; lng?: unknown } } }
      | undefined;
    const coords = data?.primarySite?.coords;
    if (!coords) return null;
    const lat = typeof coords.lat === 'number' ? coords.lat : Number(coords.lat);
    const lng = typeof coords.lng === 'number' ? coords.lng : Number(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.warn(
      `[EnvironmentBackend] resolveTenantLocation: lookup failed for tenant=${tenantId}, returning null.`,
      err,
    );
    return null;
  }
}

/**
 * Indirection seam: getForecast() calls `tenantLocationResolver(tenantId)`,
 * which defaults to {@link resolveTenantLocation}. Tests can swap the
 * resolver via {@link setTenantLocationResolver} without having to mock the
 * Firestore Admin SDK or rely on ES-module spy gymnastics.
 */
type TenantLocationResolver = (tenantId: string) => Promise<ForecastLocation | null>;
let tenantLocationResolver: TenantLocationResolver = resolveTenantLocation;

/**
 * Override the resolver used by {@link getForecast} when given a
 * `{ tenantId }` location. Pass no argument (or `undefined`) to restore the
 * default {@link resolveTenantLocation} implementation. Test-only — do not
 * call from production code.
 */
export function setTenantLocationResolver(resolver?: TenantLocationResolver): void {
  tenantLocationResolver = resolver ?? resolveTenantLocation;
}

/**
 * Fetch a multi-day climate forecast for the given location (default:
 * Santiago de Chile) and aggregate OpenWeather's 3-hour-step `/forecast`
 * payload into per-day ClimateForecastDay entries.
 *
 * Location selection precedence:
 *   1. `location` is `{ lat, lng }` → used verbatim.
 *   2. `location` is `{ tenantId }` → resolved via
 *      {@link resolveTenantLocation}; on `null` we fall through to (3) and
 *      log a warning.
 *   3. `location` is `undefined` → Santiago de Chile default
 *      (`-33.4489, -70.6693`).
 *
 * Behavior:
 *   - `days` clamped to [1, 5] (OpenWeather free-tier ceiling). days <= 0
 *     short-circuits to [] without hitting the network.
 *   - If OPENWEATHER_API_KEY env is missing → returns [] and logs a warning.
 *   - Any upstream/network failure → returns [] and logs a warning. We never
 *     throw, since the /api/environment/forecast endpoint expects graceful
 *     degradation (an empty forecast just disables climate-risk node
 *     generation in useCalendarPredictions).
 */
export async function getForecast(
  days: number,
  location?: ForecastLocation | TenantLocationContext,
): Promise<ClimateForecastDay[]> {
  if (!Number.isFinite(days) || days <= 0) return [];

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    console.warn('[EnvironmentBackend] getForecast: OPENWEATHER_API_KEY not set, returning empty forecast.');
    return [];
  }

  const clampedDays = Math.min(5, Math.max(1, Math.floor(days)));
  let resolved: ForecastLocation | undefined;
  if (isTenantContext(location)) {
    const fromTenant = await tenantLocationResolver(location.tenantId);
    if (fromTenant) {
      resolved = fromTenant;
    } else {
      console.warn(
        `[EnvironmentBackend] getForecast: tenant=${location.tenantId} has no primarySite coords, falling back to Santiago default.`,
      );
    }
  } else if (location) {
    resolved = location;
  }

  const lat = resolved?.lat ?? DEFAULT_LAT;
  const lon = resolved?.lng ?? DEFAULT_LON;

  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=es`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.warn('[EnvironmentBackend] getForecast: fetch threw, returning empty forecast.', err);
    return [];
  }

  if (!res.ok) {
    console.warn(`[EnvironmentBackend] getForecast: upstream ${res.status}, returning empty forecast.`);
    return [];
  }

  let payload: OWForecastResponse;
  try {
    payload = (await res.json()) as OWForecastResponse;
  } catch (err) {
    console.warn('[EnvironmentBackend] getForecast: malformed JSON, returning empty forecast.', err);
    return [];
  }

  const items = Array.isArray(payload.list) ? payload.list : [];
  const buckets = aggregateByDay(items).slice(0, clampedDays);
  return buckets.map(bucketToForecastDay);
}

/* -------------------------------------------------------------------------- */
/* TODO (follow-ups)                                                            */
/*                                                                              */
/*  - Wire the /api/environment/forecast endpoint to forward the authenticated  */
/*    tenant's id as `{ tenantId }` so getForecast() picks up the per-tenant    */
/*    primary-site coords resolved by resolveTenantLocation(). Today the        */
/*    helper exists and is unit-tested, but the HTTP layer in server.ts still   */
/*    passes nothing (or raw lat/lng query params).                             */
/*                                                                              */
/*  - Longer horizons: 5 days is the OpenWeather free-tier ceiling. For a       */
/*    7- or 14-day boletín we'd need the One Call paid endpoint (or a fall-     */
/*    back to a different provider). Document the tier requirement and gate     */
/*    behind a feature flag.                                                    */
/*                                                                              */
/*  - Visibility / fog: weather IDs 7xx (atmosphere) currently degrade to       */
/*    'sunny'. If we add a `visibilityKm` field to ClimateForecastDay we        */
/*    can light up reduced-visibility risk for fog/dust days.                   */
/* -------------------------------------------------------------------------- */
