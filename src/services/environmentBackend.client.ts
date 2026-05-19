/**
 * environmentBackend (frontend client)
 * ------------------------------------
 *
 * Browser-safe sibling of `src/services/environmentBackend.ts`. The original
 * `environmentBackend.ts` lives on the server side (it imports
 * `firebase-admin`) and CANNOT be imported from Vite-bundled pages.
 *
 * This client module exposes the subset of the API that the React pages need
 * to consume real environmental data. Today: `getCurrentWeather({ lat, lng })`
 * — used by HazmatMap and VolcanicEruptionMap to seed their wind direction
 * and wind speed inputs with the actual current weather at the incident
 * location, instead of arbitrary hardcoded defaults (120°/15 km/h, 45°/20 km/h).
 *
 * Implementation notes
 *   - We call OpenWeatherMap's `/weather` (current-conditions) endpoint
 *     directly with `VITE_OPENWEATHER_API_KEY` — same pattern as
 *     `orchestratorService.fetchWeatherData`.
 *   - OpenWeatherMap returns `wind.speed` in **m/s** and `wind.deg` as
 *     **direction the wind is coming FROM** (meteorological convention).
 *     For our toxic-plume / ash-plume polygons we need the direction the
 *     wind is blowing **TOWARDS**, so we add 180° and normalise to
 *     [0, 360). We also convert speed to km/h (×3.6).
 *   - Graceful degradation: if the API key is missing OR the request fails
 *     OR the response is malformed, we return `{ unavailable: true }` and
 *     the caller falls back to its manual defaults. We NEVER fabricate
 *     wind data — the consumer page surfaces this to the user with a
 *     visible banner so evacuation decisions are not made on fictional
 *     telemetry.
 *   - No `firebase-admin` import — safe to bundle for the browser.
 */
import { logger } from '../utils/logger';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY as
  | string
  | undefined;

/** Lat/lng pair. `lng` (Google convention) maps to OpenWeather's `lon`. */
export interface WeatherLocation {
  lat: number;
  lng: number;
}

/**
 * Result of {@link getCurrentWeather}. Numeric fields are always finite when
 * `unavailable` is `false`. When `unavailable` is `true` the caller MUST
 * fall back to its manual defaults and show an honest "datos no disponibles"
 * banner — we do not fabricate substitute numbers.
 */
export interface CurrentWeather {
  /** Wind speed at 10m AGL, in km/h. */
  windSpeedKmh: number;
  /**
   * Direction the wind is blowing **TOWARDS**, in degrees clockwise from
   * North (0 = N, 90 = E, 180 = S, 270 = W). This is the convention the
   * downwind plume polygons in HazmatMap / VolcanicEruptionMap expect.
   */
  windDirectionDeg: number;
  /** Human-readable location name from OpenWeather (`data.name`). */
  location: string | null;
  /**
   * When `true`, every numeric field is a placeholder (0) and the caller
   * must NOT use them — render the empty-state banner and let the user
   * input wind manually.
   */
  unavailable: boolean;
}

const UNAVAILABLE: CurrentWeather = {
  windSpeedKmh: 0,
  windDirectionDeg: 0,
  location: null,
  unavailable: true,
};

/**
 * Normalise a degrees value to [0, 360).
 *
 * OpenWeatherMap's `wind.deg` is "where the wind is FROM" (meteorological
 * convention). Our plume math wants "where the wind is going TO" so we
 * add 180°. This helper also defends against bogus values (e.g. -10° or
 * 720°) that some upstream wrappers occasionally produce.
 */
function normaliseBearing(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped;
}

/**
 * Fetch current weather at the given location and return a minimal payload
 * suitable for seeding wind UI controls (direction + speed).
 *
 * Returns `{ unavailable: true }` if `VITE_OPENWEATHER_API_KEY` is unset, if
 * the fetch fails, or if the response lacks usable wind data. We never throw
 * — pages call this in a `useEffect` and a thrown error would crash the
 * incident-response UI just to display a wind value.
 */
export async function getCurrentWeather(
  location: WeatherLocation,
): Promise<CurrentWeather> {
  if (!OPENWEATHER_API_KEY) {
    logger.warn(
      '[environmentBackend.client] VITE_OPENWEATHER_API_KEY not set — returning unavailable.',
    );
    return UNAVAILABLE;
  }

  if (
    !location ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng)
  ) {
    return UNAVAILABLE;
  }

  const url =
    `https://api.openweathermap.org/data/2.5/weather?lat=${location.lat}` +
    `&lon=${location.lng}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {}, { timeoutMs: 10_000 });
  } catch (err) {
    logger.warn('[environmentBackend.client] getCurrentWeather: fetch threw', err);
    return UNAVAILABLE;
  }

  if (!res.ok) {
    logger.warn(
      `[environmentBackend.client] getCurrentWeather: upstream ${res.status}`,
    );
    return UNAVAILABLE;
  }

  let data: {
    wind?: { speed?: number; deg?: number };
    name?: string;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch (err) {
    logger.warn('[environmentBackend.client] getCurrentWeather: malformed JSON', err);
    return UNAVAILABLE;
  }

  const speedMs = data.wind?.speed;
  const fromDeg = data.wind?.deg;
  if (typeof speedMs !== 'number' || typeof fromDeg !== 'number') {
    return UNAVAILABLE;
  }

  // wind.deg is "FROM" — flip 180° to get "TO" for downwind plume.
  const towardsDeg = normaliseBearing(fromDeg + 180);

  return {
    windSpeedKmh: Math.round(speedMs * 3.6 * 10) / 10,
    windDirectionDeg: Math.round(towardsDeg),
    location: typeof data.name === 'string' ? data.name : null,
    unavailable: false,
  };
}
