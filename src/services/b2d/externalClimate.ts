// Praeventio Guard — B2D External Climate sources (§2.16 cierre Fase C.4, 2026-05-21).
//
// Wire real de las 3 fuentes externas que el marketing B2D prometía:
//   1. Open-Meteo (https://open-meteo.com) — clima current + forecast.
//      Gratuito, SIN api key. Rate limit ~10k requests/day per IP.
//   2. USGS Earthquake Catalog (https://earthquake.usgs.gov/fdsnws/event/1)
//      Gratuito, SIN api key. Sin rate limit documentado.
//   3. OpenAQ (https://api.openaq.org/v3) — calidad del aire.
//      Key opcional via OPENAQ_API_KEY; sin key da rate limit más bajo.
//
// Estrategia (Regla #3 inviolable del TODO.md):
//   - Cada función devuelve `{ data, source }` o `null` cuando falla
//     (timeout, 5xx, parse error). El caller decide si combinar fuentes o
//     caer a fallback determinístico.
//   - Cache server-side in-memory por 1h (TTL) para no martillar APIs +
//     reducir costos egreso. Bucket por (lat redondeado a 2 decimales,
//     lng redondeado a 2 decimales, kind).
//
// Privacidad B2D inviolable: NUNCA pasa tenantId / customerId al upstream.
// Solo coordenadas geográficas + radio + horizonte temporal.

import { logger } from '../../utils/logger.js';

// ── Cache simple in-memory ─────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 8_000;

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function bucketCoord(n: number): number {
  // Redondeo a 2 decimales — radio ~1.1 km en ecuador, suficiente para cache.
  return Math.round(n * 100) / 100;
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit & { headers?: Record<string, string> },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Open-Meteo (clima) ─────────────────────────────────────────────────────

export interface OpenMeteoCurrent {
  tempC: number;
  humidityPct: number;
  windKmh: number;
  windDirectionDeg: number;
  pressureHpa: number;
  cloudCoverPct: number;
  uvIndex: number | null; // Open-Meteo no siempre lo devuelve
}

export interface OpenMeteoForecastDay {
  date: string; // YYYY-MM-DD
  tempMinC: number;
  tempMaxC: number;
  precipitationMm: number;
  windKmh: number;
}

interface OpenMeteoApiCurrent {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    pressure_msl?: number;
    cloud_cover?: number;
    uv_index?: number;
  };
}

interface OpenMeteoApiDaily {
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    wind_speed_10m_max?: number[];
  };
}

interface OpenMeteoApiHourly {
  hourly?: {
    time?: string[];
    wind_speed_10m?: number[];
  };
}

/**
 * Short-horizon hourly wind forecast — one sample per upcoming hour.
 * `windKmh[i]` is the predicted 10 m wind speed at `time[i]`. This is the
 * cadence the per-minute predictive scheduler needs (a DAILY forecast index
 * cannot be treated as a minute offset); see structuralLoadProbe.ts.
 */
export interface OpenMeteoHourlyWind {
  /** ISO local timestamps, one per hour. */
  time: string[];
  /** Predicted wind speed (km/h) per hour, aligned with `time`. */
  windKmh: number[];
}

export async function fetchOpenMeteoCurrent(
  lat: number,
  lng: number,
): Promise<{ data: OpenMeteoCurrent; source: 'openmeteo' } | null> {
  const key = `openmeteo:current:${bucketCoord(lat)}:${bucketCoord(lng)}`;
  const cached = cacheGet<{ data: OpenMeteoCurrent; source: 'openmeteo' }>(key);
  if (cached) return cached;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,` +
    `wind_direction_10m,pressure_msl,cloud_cover,uv_index&forecast_days=1`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      logger.warn('openmeteo_current_failed', { status: res.status });
      return null;
    }
    const json = (await res.json()) as OpenMeteoApiCurrent;
    const c = json.current;
    if (!c || typeof c.temperature_2m !== 'number') {
      logger.warn('openmeteo_current_invalid_shape');
      return null;
    }
    const out = {
      data: {
        tempC: Math.round((c.temperature_2m ?? 0) * 10) / 10,
        humidityPct: Math.round(c.relative_humidity_2m ?? 0),
        windKmh: Math.round((c.wind_speed_10m ?? 0) * 10) / 10,
        windDirectionDeg: Math.round(c.wind_direction_10m ?? 0),
        pressureHpa: Math.round(c.pressure_msl ?? 1013),
        cloudCoverPct: Math.round(c.cloud_cover ?? 0),
        uvIndex: typeof c.uv_index === 'number' ? Math.round(c.uv_index * 10) / 10 : null,
      } satisfies OpenMeteoCurrent,
      source: 'openmeteo' as const,
    };
    cacheSet(key, out);
    return out;
  } catch (err) {
    logger.warn('openmeteo_current_threw', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function fetchOpenMeteoForecast(
  lat: number,
  lng: number,
  days: number,
): Promise<{ data: OpenMeteoForecastDay[]; source: 'openmeteo' } | null> {
  const cappedDays = Math.min(14, Math.max(1, Math.floor(days)));
  const key = `openmeteo:forecast:${bucketCoord(lat)}:${bucketCoord(lng)}:${cappedDays}`;
  const cached = cacheGet<{ data: OpenMeteoForecastDay[]; source: 'openmeteo' }>(key);
  if (cached) return cached;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,` +
    `wind_speed_10m_max&forecast_days=${cappedDays}&timezone=auto`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      logger.warn('openmeteo_forecast_failed', { status: res.status });
      return null;
    }
    const json = (await res.json()) as OpenMeteoApiDaily;
    const d = json.daily;
    if (!d || !Array.isArray(d.time) || d.time.length === 0) {
      logger.warn('openmeteo_forecast_invalid_shape');
      return null;
    }
    const out = {
      data: d.time.map((date, i) => ({
        date,
        tempMinC: Math.round((d.temperature_2m_min?.[i] ?? 0) * 10) / 10,
        tempMaxC: Math.round((d.temperature_2m_max?.[i] ?? 0) * 10) / 10,
        precipitationMm: Math.round((d.precipitation_sum?.[i] ?? 0) * 10) / 10,
        windKmh: Math.round((d.wind_speed_10m_max?.[i] ?? 0) * 10) / 10,
      })),
      source: 'openmeteo' as const,
    };
    cacheSet(key, out);
    return out;
  } catch (err) {
    logger.warn('openmeteo_forecast_threw', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Fetch the next `hours` of hourly wind (km/h) from Open-Meteo. Unlike the
 * daily forecast (`wind_speed_10m_max` per day), this returns one sample per
 * hour starting at the current hour, which is the short-horizon cadence the
 * predictive scheduler consumes. Free, no API key. Returns `null` on
 * timeout / 5xx / parse failure (caller falls back to "no probe", never a
 * fabricated wind value).
 */
export async function fetchOpenMeteoHourlyWind(
  lat: number,
  lng: number,
  hours: number,
): Promise<{ data: OpenMeteoHourlyWind; source: 'openmeteo' } | null> {
  const cappedHours = Math.min(48, Math.max(1, Math.floor(hours)));
  const key = `openmeteo:hourlywind:${bucketCoord(lat)}:${bucketCoord(lng)}:${cappedHours}`;
  const cached = cacheGet<{ data: OpenMeteoHourlyWind; source: 'openmeteo' }>(key);
  if (cached) return cached;

  // forecast_days=1 covers up to 24 hourly samples; request 2 days when the
  // caller needs more than 24 hours of horizon.
  const forecastDays = cappedHours > 24 ? 2 : 1;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=wind_speed_10m&forecast_days=${forecastDays}&timezone=auto`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      logger.warn('openmeteo_hourly_wind_failed', { status: res.status });
      return null;
    }
    const json = (await res.json()) as OpenMeteoApiHourly;
    const h = json.hourly;
    if (
      !h ||
      !Array.isArray(h.time) ||
      h.time.length === 0 ||
      !Array.isArray(h.wind_speed_10m)
    ) {
      logger.warn('openmeteo_hourly_wind_invalid_shape');
      return null;
    }
    // Take the first `cappedHours` samples (the imminent horizon).
    const limit = Math.min(cappedHours, h.time.length, h.wind_speed_10m.length);
    const time: string[] = [];
    const windKmh: number[] = [];
    for (let i = 0; i < limit; i++) {
      const w = h.wind_speed_10m[i];
      if (typeof w !== 'number' || !Number.isFinite(w)) continue;
      time.push(h.time[i] ?? '');
      windKmh.push(Math.round(w * 10) / 10);
    }
    if (windKmh.length === 0) {
      logger.warn('openmeteo_hourly_wind_no_samples');
      return null;
    }
    const out = {
      data: { time, windKmh } satisfies OpenMeteoHourlyWind,
      source: 'openmeteo' as const,
    };
    cacheSet(key, out);
    return out;
  } catch (err) {
    logger.warn('openmeteo_hourly_wind_threw', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── USGS Earthquakes ────────────────────────────────────────────────────────

export interface UsgsEarthquakeSummary {
  last24hMaxMagnitude: number | null;
  nearbyEventCount: number;
  events: Array<{ magnitude: number; depthKm: number; placeText: string; timeIso: string }>;
}

interface UsgsApiFeature {
  properties?: { mag?: number; place?: string; time?: number };
  geometry?: { coordinates?: number[] };
}

export async function fetchUsgsEarthquakesNearby(
  lat: number,
  lng: number,
  radiusKm: number = 200,
): Promise<{ data: UsgsEarthquakeSummary; source: 'usgs' } | null> {
  const cappedRadius = Math.min(500, Math.max(10, Math.round(radiusKm)));
  const key = `usgs:${bucketCoord(lat)}:${bucketCoord(lng)}:${cappedRadius}`;
  const cached = cacheGet<{ data: UsgsEarthquakeSummary; source: 'usgs' }>(key);
  if (cached) return cached;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${lat}&longitude=${lng}&maxradiuskm=${cappedRadius}` +
    `&starttime=${since}&minmagnitude=2.5`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      logger.warn('usgs_failed', { status: res.status });
      return null;
    }
    const json = (await res.json()) as { features?: UsgsApiFeature[] };
    const features = Array.isArray(json.features) ? json.features : [];
    const events = features
      .map((f) => ({
        magnitude: typeof f.properties?.mag === 'number' ? f.properties.mag : 0,
        depthKm:
          typeof f.geometry?.coordinates?.[2] === 'number' ? f.geometry.coordinates[2] : 0,
        placeText: typeof f.properties?.place === 'string' ? f.properties.place : '',
        timeIso:
          typeof f.properties?.time === 'number'
            ? new Date(f.properties.time).toISOString()
            : new Date().toISOString(),
      }))
      .filter((e) => e.magnitude >= 2.5)
      .slice(0, 50);
    const maxMag = events.length > 0 ? Math.max(...events.map((e) => e.magnitude)) : null;
    const out = {
      data: {
        last24hMaxMagnitude: maxMag,
        nearbyEventCount: events.length,
        events,
      } satisfies UsgsEarthquakeSummary,
      source: 'usgs' as const,
    };
    cacheSet(key, out);
    return out;
  } catch (err) {
    logger.warn('usgs_threw', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── OpenAQ Air Quality ──────────────────────────────────────────────────────

export interface OpenAqSummary {
  pm25UgM3: number | null;
  pm10UgM3: number | null;
  aqi: number | null;
  measurementsCount: number;
}

interface OpenAqApiV3Loc {
  results?: Array<{
    id: number;
    parameters?: Array<{
      parameter: string;
      lastValue?: number;
      unit?: string;
    }>;
    sensors?: Array<{
      parameter?: { name?: string; units?: string };
      lastValue?: number;
    }>;
  }>;
}

export async function fetchOpenAqAirQuality(
  lat: number,
  lng: number,
  radiusKm: number = 25,
): Promise<{ data: OpenAqSummary; source: 'openaq' } | null> {
  const cappedRadius = Math.min(50, Math.max(1, Math.round(radiusKm)));
  const key = `openaq:${bucketCoord(lat)}:${bucketCoord(lng)}:${cappedRadius}`;
  const cached = cacheGet<{ data: OpenAqSummary; source: 'openaq' }>(key);
  if (cached) return cached;

  const radiusMeters = cappedRadius * 1000;
  const url =
    `https://api.openaq.org/v3/locations?coordinates=${lat},${lng}` +
    `&radius=${radiusMeters}&limit=10`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.OPENAQ_API_KEY) {
    headers['X-API-Key'] = process.env.OPENAQ_API_KEY;
  }

  try {
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) {
      // 401 sin key es esperado; otros 4xx/5xx = upstream issue
      if (res.status !== 401) {
        logger.warn('openaq_failed', { status: res.status });
      }
      return null;
    }
    const json = (await res.json()) as OpenAqApiV3Loc;
    const locations = Array.isArray(json.results) ? json.results : [];
    if (locations.length === 0) return null;

    // Tomamos la primera location y extraemos pm25/pm10. OpenAQ v3 expone
    // los valores via sensors[].lastValue cuando parameters[] no está.
    let pm25: number | null = null;
    let pm10: number | null = null;
    let measurementsCount = 0;

    for (const loc of locations) {
      const sensors = loc.sensors ?? [];
      const params = loc.parameters ?? [];
      for (const s of sensors) {
        const name = s.parameter?.name ?? '';
        if (typeof s.lastValue === 'number' && Number.isFinite(s.lastValue)) {
          if (name === 'pm25' && pm25 === null) pm25 = s.lastValue;
          if (name === 'pm10' && pm10 === null) pm10 = s.lastValue;
          measurementsCount += 1;
        }
      }
      for (const p of params) {
        if (typeof p.lastValue === 'number' && Number.isFinite(p.lastValue)) {
          if (p.parameter === 'pm25' && pm25 === null) pm25 = p.lastValue;
          if (p.parameter === 'pm10' && pm10 === null) pm10 = p.lastValue;
          measurementsCount += 1;
        }
      }
      if (pm25 !== null && pm10 !== null) break;
    }

    // AQI conversion simplificada — EPA breakpoints PM2.5 24h-avg.
    let aqi: number | null = null;
    if (pm25 !== null) {
      if (pm25 <= 12) aqi = Math.round((50 / 12) * pm25);
      else if (pm25 <= 35.4) aqi = Math.round(50 + ((100 - 50) / (35.4 - 12)) * (pm25 - 12));
      else if (pm25 <= 55.4) aqi = Math.round(100 + ((150 - 100) / (55.4 - 35.4)) * (pm25 - 35.4));
      else if (pm25 <= 150.4) aqi = Math.round(150 + ((200 - 150) / (150.4 - 55.4)) * (pm25 - 55.4));
      else if (pm25 <= 250.4) aqi = Math.round(200 + ((300 - 200) / (250.4 - 150.4)) * (pm25 - 150.4));
      else aqi = 301;
    }

    const out = {
      data: {
        pm25UgM3: pm25 !== null ? Math.round(pm25 * 10) / 10 : null,
        pm10UgM3: pm10 !== null ? Math.round(pm10 * 10) / 10 : null,
        aqi,
        measurementsCount,
      } satisfies OpenAqSummary,
      source: 'openaq' as const,
    };
    cacheSet(key, out);
    return out;
  } catch (err) {
    logger.warn('openaq_threw', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── Reset helper (para tests) ───────────────────────────────────────────────

/** Limpia el cache in-memory. Solo para tests; no llamar en producción. */
export function __resetExternalClimateCache(): void {
  cache.clear();
}
