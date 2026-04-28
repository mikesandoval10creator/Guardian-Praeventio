/**
 * GPS-based country detection for the normativa pack loader.
 *
 * Strategy (in priority order):
 *   1. Manual override (user picked a pack via NormativaSwitch).
 *   2. GPS — `navigator.geolocation.getCurrentPosition` + bounding-box match
 *      against the 6 supported LATAM countries. Requires explicit `consent`.
 *   3. `navigator.language` heuristic (es-CL → CL, pt-BR → BR, …).
 *   4. ISO 45001 fallback.
 *
 * The bounding boxes below are intentionally coarse approximations — see
 * `COUNTRY_BBOXES` for citations. They are NOT a substitute for proper reverse
 * geocoding (the app already loads the Google Maps SDK; a future iteration can
 * delegate to the Geocoding API for sub-degree precision and overseas
 * territories. See TODOs).
 *
 * Pure helpers (`countryFromCoords`, `countryFromLanguage`) are TDD-covered in
 * `./locationNormativa.test.ts`; the orchestrator `detectCountry` is intentionally
 * thin and side-effecting (geolocation API + localStorage), tested manually in QA.
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

    const code = countryFromCoords(pos.coords.latitude, pos.coords.longitude);
    if (code && code !== 'ISO') {
      return { source: 'gps', code, accuracy: pos.coords.accuracy };
    }
    // GPS resolved but outside all bboxes — fall through to language.
    const fromLang = countryFromLanguage(lang);
    if (fromLang === 'ISO') return { source: 'default', code: 'ISO' };
    return { source: 'language', code: fromLang };
  } catch {
    const fromLang = countryFromLanguage(lang);
    if (fromLang === 'ISO') return { source: 'default', code: 'ISO' };
    return { source: 'language', code: fromLang };
  }
}
