// Praeventio Guard — server-side wind verification for critical work permits.
//
// Problem (arista clima→permisos, 2026-06-10): the validate-critical endpoint
// fed `windSpeedMps` straight from the CLIENT body into the DS 132 / ISO 12480
// wind thresholds (11 m/s advisory, 15 m/s blocking — criticalPermitValidators
// IZAJE_WIND_*). A requester who lies (or whose handheld anemometer reading is
// stale) bypasses a life-safety check. This module resolves an INDEPENDENT
// server-side wind sample and merges it with the declared value under a
// fail-safe policy.
//
// Provider note: the real fetcher is `getForecast` from
// `src/services/environmentBackend.ts` (OpenWeather /forecast aggregation —
// NOT Open-Meteo, despite older doc claims; the code is the source of truth).
// It returns `ClimateForecastDay[]` where day-0 carries `windKmh?` = max wind
// of the day in km/h, and degrades to `[]` on any upstream failure (never
// throws). We inject it (DI) so this module stays pure and unit-testable.
//
// Merge policy (safety-first, conservative):
//   - effective = max(client ?? 0, server) whenever server data exists. A
//     client declaring HIGHER than the forecast keeps its own worse value
//     (local gusts are real); declaring LOWER never weakens the validation.
//   - discrepancy when the client declared ≥ WIND_DISCREPANCY_THRESHOLD_MPS
//     below the server sample — surfaced to the supervisor as an advisory.
//   - server unavailable → validate with the declared value, but attach an
//     es-CL note stating the wind could not be independently verified.

/** Minimal structural slice of ClimateForecastDay that the gate needs. */
export interface ForecastDayWind {
  /** Max wind of the day in km/h (environmentBackend aggregation). */
  windKmh?: number;
}

export interface WeatherGateDeps {
  /**
   * Forecast fetcher — production wiring passes
   * `environmentBackend.getForecast`. Must resolve `[]`-style degraded
   * output on failure, but the gate also tolerates rejections.
   */
  fetchForecast: (
    days: number,
    location: { lat: number; lng: number },
  ) => Promise<ForecastDayWind[]>;
}

export interface ServerWind {
  /** Independent wind sample in m/s, or null when not resolvable. */
  windSpeedMps: number | null;
  source: 'openweather' | 'unavailable';
}

export interface WindMergeResult {
  /** Wind value (m/s) the validators must run with; null = nothing known. */
  effectiveWindMps: number | null;
  serverWindMps: number | null;
  clientWindMps: number | null;
  source: ServerWind['source'];
  /** Client declared ≥ WIND_DISCREPANCY_THRESHOLD_MPS below the server. */
  discrepancy: boolean;
  /** es-CL advisory copy when the server sample is unavailable. */
  note?: string;
}

/** Declared-below-server gap (m/s) that flags a discrepancy. */
export const WIND_DISCREPANCY_THRESHOLD_MPS = 2;

/** User-facing es-CL copy — surfaced when independent verification failed. */
export const WIND_UNVERIFIED_NOTE_ES =
  'No fue posible verificar el viento de forma independiente — valor declarado por el solicitante.';

const SERVER_UNAVAILABLE: ServerWind = {
  windSpeedMps: null,
  source: 'unavailable',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve the independent server-side wind for a site. Never throws — any
 * fetcher failure, empty forecast or missing/non-finite `windKmh` degrades to
 * `{ windSpeedMps: null, source: 'unavailable' }`.
 */
export async function resolveServerWind(
  deps: WeatherGateDeps,
  location: { lat: number; lng: number },
): Promise<ServerWind> {
  try {
    const days = await deps.fetchForecast(1, location);
    const windKmh = Array.isArray(days) ? days[0]?.windKmh : undefined;
    if (typeof windKmh !== 'number' || !Number.isFinite(windKmh)) {
      return SERVER_UNAVAILABLE;
    }
    return { windSpeedMps: round2(windKmh / 3.6), source: 'openweather' };
  } catch {
    return SERVER_UNAVAILABLE;
  }
}

/**
 * `resolveServerWind` bounded by a hard deadline (default 3 s). The
 * validate-critical endpoint must NEVER hang on a slow weather upstream —
 * past the deadline we degrade to `unavailable` and the merge falls back to
 * the declared value (with the unverified note).
 */
export async function resolveServerWindWithTimeout(
  deps: WeatherGateDeps,
  location: { lat: number; lng: number },
  timeoutMs = 3000,
): Promise<ServerWind> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ServerWind>((resolve) => {
    timer = setTimeout(() => resolve(SERVER_UNAVAILABLE), timeoutMs);
  });
  try {
    return await Promise.race([resolveServerWind(deps, location), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Merge the client-declared wind with the server sample under the safety
 * policy documented in the module header. Pure + deterministic.
 */
export function mergeWindForValidation(
  clientWind: number | null | undefined,
  serverWind: ServerWind,
): WindMergeResult {
  // Non-finite or negative declarations are noise, not data.
  const client =
    typeof clientWind === 'number' &&
    Number.isFinite(clientWind) &&
    clientWind >= 0
      ? clientWind
      : null;

  if (serverWind.windSpeedMps === null) {
    return {
      effectiveWindMps: client,
      serverWindMps: null,
      clientWindMps: client,
      source: 'unavailable',
      discrepancy: false,
      note: WIND_UNVERIFIED_NOTE_ES,
    };
  }

  const server = serverWind.windSpeedMps;
  const effective = Math.max(client ?? 0, server);
  const discrepancy =
    client !== null && server - client >= WIND_DISCREPANCY_THRESHOLD_MPS;

  return {
    effectiveWindMps: effective,
    serverWindMps: server,
    clientWindMps: client,
    source: serverWind.source,
    discrepancy,
  };
}
