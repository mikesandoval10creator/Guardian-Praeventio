/**
 * GPS-based country detection for the normativa pack loader.
 *
 * Strategy (in priority order):
 *   1. Manual override (user picked a pack via NormativaSwitch).
 *   2. GPS — `navigator.geolocation.getCurrentPosition` + reverse-geocoding via
 *      Google Maps Geocoding API (when `VITE_GOOGLE_MAPS_API_KEY` is set), with
 *      a synchronous bounding-box fallback for offline / no-API-key paths.
 *      Requires explicit `consent`.
 *   3. `navigator.language` heuristic (es-CL → CL, pt-BR → BR, …).
 *   4. ISO 45001 fallback.
 *
 * The bounding boxes below are intentionally coarse approximations — see
 * `COUNTRY_BBOXES` for citations. They miss overseas territories (e.g.
 * French Guiana, Easter Island when assigning the right country) and
 * dual-jurisdiction borders. The async path (`countryFromCoordsAsync`) calls
 * Google Maps Geocoding for worldwide accuracy and falls back to the bbox
 * method when the API key is missing or the call fails.
 *
 * Pure helpers (`countryFromCoords`, `countryFromLanguage`,
 * `mapAlpha2ToCountryCode`) are TDD-covered in `./locationNormativa.test.ts`;
 * the orchestrator `detectCountry` is intentionally thin and side-effecting
 * (geolocation API + localStorage), tested manually in QA.
 *
 * Cost note: Google Maps Geocoding API is billed at roughly USD 5 per 1000
 * requests (Standard tier, 2025). Callers that mass-geocode (e.g. a batch
 * worker) should cache results and add per-tenant throttling.
 */
import type { CountryCode } from './countryPacks';

export type CountryDetectionResult =
  | { source: 'gps'; code: CountryCode; accuracy: number }
  | { source: 'language'; code: CountryCode }
  | { source: 'manual'; code: CountryCode }
  | { source: 'default'; code: 'ISO' };

/**
 * Coarse bounding boxes for the 6 supported LATAM countries.
 *
 * Format: `{ minLat, maxLat, minLng, maxLng }` in WGS-84 decimal degrees.
 *
 * Source citation: figures are rounded from the public-domain country envelopes
 * available at:
 *   - Natural Earth Data 1:50m Admin 0 — Countries (https://www.naturalearthdata.com/)
 *     consolidated by Klokan Tech / OpenStreetMap nominatim country extents.
 *   - Cross-checked against the GeoJSON country dataset bundled in
 *     `world-atlas` 110m (https://github.com/topojson/world-atlas).
 *
 * These envelopes intentionally exclude overseas territories that conflict with
 * the regulatory framework of the declared country (e.g. Easter Island under CL
 * normativa is fine, but French Guiana adjacent to BR is NOT included in BR).
 *
 * Order in `COUNTRY_BBOXES_ORDERED` matters when a coordinate sits in two
 * overlapping envelopes (rare given the geographic separation of LATAM
 * jurisdictions, but defensive — Chile/Argentina share the Andes border and a
 * point at the cordillera could match both rectangles). Smaller / more
 * specific envelopes come first.
 */
interface BBox {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLng: number;
  readonly maxLng: number;
}

const COUNTRY_BBOXES: Record<Exclude<CountryCode, 'ISO'>, BBox> = {
  // Chile: long, narrow strip down the Pacific coast.
  CL: { minLat: -56.0, maxLat: -17.5, minLng: -75.7, maxLng: -66.4 },
  // Peru.
  PE: { minLat: -18.4, maxLat: -0.04, minLng: -81.4, maxLng: -68.6 },
  // Colombia.
  CO: { minLat: -4.3, maxLat: 13.5, minLng: -79.0, maxLng: -66.8 },
  // Mexico (mainland + Yucatán + Baja).
  MX: { minLat: 14.5, maxLat: 32.7, minLng: -118.4, maxLng: -86.7 },
  // Argentina.
  AR: { minLat: -55.1, maxLat: -21.8, minLng: -73.6, maxLng: -53.6 },
  // Brazil.
  BR: { minLat: -33.8, maxLat: 5.3, minLng: -74.0, maxLng: -34.7 },
};

/**
 * Order of resolution when a point matches multiple envelopes. CL is checked
 * before AR because the CL strip is narrower (longitude < -66.4) so a point in
 * Andes border zones falls back to AR only if outside CL's longitude window.
 */
const COUNTRY_BBOXES_ORDERED: readonly Exclude<CountryCode, 'ISO'>[] = [
  'CL',
  'PE',
  'CO',
  'MX',
  'AR',
  'BR',
];

function inside(lat: number, lng: number, bbox: BBox): boolean {
  return (
    lat >= bbox.minLat &&
    lat <= bbox.maxLat &&
    lng >= bbox.minLng &&
    lng <= bbox.maxLng
  );
}

/**
 * Maps a (lat, lng) pair to a supported country code via bounding-box match.
 *
 * Synchronous: uses the bounding-box approximations declared above. Fast and
 * does not consume Google Maps API quota, but misses overseas territories
 * and dual-jurisdiction borders. Callers that need worldwide accuracy should
 * use {@link countryFromCoordsAsync} instead.
 *
 * @returns the matching `CountryCode`, or `null` if the coordinates fall
 *   outside every supported envelope (caller falls back to ISO) or are NaN.
 */
export function countryFromCoords(lat: number, lng: number): CountryCode | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const code of COUNTRY_BBOXES_ORDERED) {
    if (inside(lat, lng, COUNTRY_BBOXES[code])) return code;
  }
  return null;
}

/**
 * Set of CountryCodes that have a dedicated normativa pack. Anything else is
 * routed to the ISO 45001 fallback.
 */
export const SUPPORTED_COUNTRIES: ReadonlySet<CountryCode> = new Set<CountryCode>([
  'CL',
  'PE',
  'CO',
  'MX',
  'AR',
  'BR',
  'ISO',
]);

/**
 * Map an ISO 3166-1 alpha-2 country code (case-insensitive) to a supported
 * `CountryCode`. Unknown / unsupported codes (US, FR, etc.) and falsy inputs
 * resolve to `'ISO'`.
 */
export function mapAlpha2ToCountryCode(code: string | undefined | null): CountryCode {
  if (!code || typeof code !== 'string') return 'ISO';
  const upper = code.trim().toUpperCase();
  if (!upper) return 'ISO';
  if ((SUPPORTED_COUNTRIES as ReadonlySet<string>).has(upper) && upper !== 'ISO') {
    return upper as CountryCode;
  }
  return 'ISO';
}

/**
 * Read the Google Maps API key. Read at call time (not module load) so tests
 * can override `import.meta.env` / `process.env` between cases.
 *
 * Looks first at `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` (Vite client
 * builds) and falls back to `process.env.VITE_GOOGLE_MAPS_API_KEY` for
 * Node-side (server.ts, tests).
 */
function readGoogleMapsApiKey(): string | undefined {
  try {
    const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const fromVite = viteEnv?.VITE_GOOGLE_MAPS_API_KEY;
    if (fromVite) return fromVite;
  } catch {
    // import.meta.env may be undefined in some Node test environments.
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.VITE_GOOGLE_MAPS_API_KEY;
  }
  return undefined;
}

interface GeocodeAddressComponent {
  short_name?: string;
  long_name?: string;
  types?: string[];
}

interface GeocodeResult {
  address_components?: GeocodeAddressComponent[];
}

interface GeocodeResponse {
  results?: GeocodeResult[];
  status?: string;
}

function extractAlpha2(payload: GeocodeResponse): string | null {
  if (payload.status && payload.status !== 'OK') return null;
  const results = payload.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  for (const r of results) {
    const components = r.address_components;
    if (!Array.isArray(components)) continue;
    for (const c of components) {
      if (c.types?.includes('country') && c.short_name) {
        return c.short_name;
      }
    }
  }
  return null;
}

/**
 * Reverse-geocode `(lat, lng)` to a supported `CountryCode` using Google
 * Maps Geocoding API. Falls back to {@link countryFromCoords} (bbox method)
 * when:
 *   - `VITE_GOOGLE_MAPS_API_KEY` is unset,
 *   - the underlying `fetch` rejects (network error, abort),
 *   - the API returns a non-OK HTTP status,
 *   - the JSON payload cannot be parsed.
 *
 * When the API responds with a recognisable status but no country (status
 * `ZERO_RESULTS` over the open ocean, etc.) the function returns `'ISO'`
 * directly — an ocean is unambiguously NOT one of the supported LATAM
 * jurisdictions, so falling back to the bbox method would be misleading.
 *
 * Cost: roughly USD 5 per 1000 requests on the Geocoding API (Standard
 * tier, 2025). Throttle in your caller if mass-geocoding.
 *
 * @param options.signal — optional `AbortSignal` to cancel the request. The
 *   abort error is rethrown so callers can distinguish cancellation from
 *   other failures.
 */
export async function countryFromCoordsAsync(
  lat: number,
  lng: number,
  options?: { signal?: AbortSignal },
): Promise<CountryCode> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'ISO';

  const apiKey = readGoogleMapsApiKey();
  if (!apiKey) {
    return countryFromCoords(lat, lng) ?? 'ISO';
  }

  // Round 13 NIT hardening: clamp coords to 6 decimals (≈11cm precision —
  // far more than civilian GPS) so the URL is stable across float drift
  // (cache key benefit if a caller layer memoises by URL), then
  // `encodeURIComponent` each side of the comma so a future caller passing
  // unexpected characters (sign-flipped zero, NaN-like strings via wider
  // typings) cannot smuggle query separators into the URL. The API key is
  // already encoded once below — the comma between lat and lng stays raw,
  // matching Google's documented `latlng=<lat>,<lng>` format.
  const latStr = encodeURIComponent(lat.toFixed(6));
  const lngStr = encodeURIComponent(lng.toFixed(6));
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?latlng=${latStr},${lngStr}&key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetch(url, options?.signal ? { signal: options.signal } : undefined);
  } catch (err) {
    // AbortError must propagate so callers can distinguish cancellation.
    if (
      err instanceof Error &&
      (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR')
    ) {
      throw err;
    }
    return countryFromCoords(lat, lng) ?? 'ISO';
  }

  if (!res.ok) {
    return countryFromCoords(lat, lng) ?? 'ISO';
  }

  let payload: GeocodeResponse;
  try {
    payload = (await res.json()) as GeocodeResponse;
  } catch {
    return countryFromCoords(lat, lng) ?? 'ISO';
  }

  // Recognisable "no results" status — the API resolved cleanly, but the
  // point is over the ocean / Antarctica / unmapped. Don't fall back to
  // bbox; just return ISO.
  if (payload.status === 'ZERO_RESULTS') return 'ISO';

  const alpha2 = extractAlpha2(payload);
  if (!alpha2) {
    // Status was OK but no country component — e.g. partial results. Fall
    // back to the bbox method as a best-effort guess.
    return countryFromCoords(lat, lng) ?? 'ISO';
  }

  return mapAlpha2ToCountryCode(alpha2);
}

/**
 * Heuristic country from a BCP-47 language tag.
 *
 * `es-CL` → `CL`, `pt-BR` → `BR`, anything else → `'ISO'`.
 *
 * Note: a bare `es` (no region subtag) intentionally falls back to ISO rather
 * than guessing a default LATAM country — the user can still override manually.
 */
export function countryFromLanguage(lang: string | undefined | null): CountryCode {
  if (!lang || typeof lang !== 'string') return 'ISO';
  const lower = lang.toLowerCase();
  if (lower.startsWith('es-cl')) return 'CL';
  if (lower.startsWith('es-pe')) return 'PE';
  if (lower.startsWith('es-co')) return 'CO';
  if (lower.startsWith('es-mx')) return 'MX';
  if (lower.startsWith('es-ar')) return 'AR';
  if (lower.startsWith('pt-br') || lower === 'pt') return 'BR';
  return 'ISO';
}

/**
 * Orchestrates country detection.
 *
 * Caller MUST pass `consent: true` to use GPS (privacy-first); otherwise we
 * skip geolocation entirely. A `manualOverride` short-circuits everything.
 *
 * Times out the geolocation API at 5 seconds; on timeout/error we fall back to
 * `countryFromLanguage(navigator.language)` and ultimately to ISO.
 */
export async function detectCountry(opts?: {
  consent: boolean;
  manualOverride?: CountryCode;
}): Promise<CountryDetectionResult> {
  const consent = opts?.consent ?? false;
  const manual = opts?.manualOverride;

  if (manual) {
    return { source: 'manual', code: manual };
  }

  const lang =
    typeof navigator !== 'undefined' ? navigator.language : undefined;

  if (!consent || typeof navigator === 'undefined' || !navigator.geolocation) {
    const fromLang = countryFromLanguage(lang);
    if (fromLang === 'ISO') return { source: 'default', code: 'ISO' };
    return { source: 'language', code: fromLang };
  }

  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 5_000,
      });
    });

    // Prefer Google Maps Geocoding (worldwide accuracy + overseas
    // territories) when an API key is configured; otherwise fall back to
    // the synchronous bbox method. `countryFromCoordsAsync` handles its
    // own internal fallback if the API call fails.
    const apiKey = readGoogleMapsApiKey();
    let code: CountryCode | null;
    if (apiKey) {
      try {
        code = await countryFromCoordsAsync(
          pos.coords.latitude,
          pos.coords.longitude,
        );
      } catch {
        code = countryFromCoords(pos.coords.latitude, pos.coords.longitude);
      }
    } else {
      code = countryFromCoords(pos.coords.latitude, pos.coords.longitude);
    }

    if (code && code !== 'ISO') {
      return { source: 'gps', code, accuracy: pos.coords.accuracy };
    }
    // GPS resolved but unsupported / outside all bboxes — fall through to
    // language.
    const fromLang = countryFromLanguage(lang);
    if (fromLang === 'ISO') return { source: 'default', code: 'ISO' };
    return { source: 'language', code: fromLang };
  } catch {
    const fromLang = countryFromLanguage(lang);
    if (fromLang === 'ISO') return { source: 'default', code: 'ISO' };
    return { source: 'language', code: fromLang };
  }
}
