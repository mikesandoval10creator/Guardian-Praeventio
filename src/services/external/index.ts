// External natural-event feeds — shared module re-exports.
//
// Provides:
//   - Singleton instances of `EonetAdapter` and `UsgsEarthquakeAdapter`
//     so UI surfaces share the in-memory cache (1h EONET / 5min USGS).
//   - `bboxFromCenter()` helper to derive a small bbox from a project's
//     `{ lat, lng }` for adapter calls.
//
// Sprint 39 J4 wiring (Calendar / CoastalEmergencyMap / Driving) imports
// from here so the UI never instantiates adapters per-mount.

import { EonetAdapter } from './eonet/eonetAdapter.js';
import { UsgsEarthquakeAdapter } from './usgs/usgsEarthquakeAdapter.js';
import type { BBox } from './eonet/types.js';

export const eonetAdapter = new EonetAdapter();
export const usgsEarthquakeAdapter = new UsgsEarthquakeAdapter();

export { EonetAdapter, UsgsEarthquakeAdapter };
export { buildCalmRecommendation } from './recommendationBuilder.js';
export type {
  CalmRecommendation,
  RecommendationSeverity,
} from './recommendationBuilder.js';
export type { EonetEvent, EonetCategory, BBox } from './eonet/types.js';
export type { UsgsEarthquake } from './usgs/types.js';

/**
 * Build a small bbox around a project center. `degrees` defaults to ~1°
 * which at mid-latitudes is roughly ±100km — enough to surface regional
 * EONET events without flooding the UI with global noise.
 */
export function bboxFromCenter(
  center: { lat: number; lng: number },
  degrees = 1,
): BBox {
  return {
    lonMin: center.lng - degrees,
    lonMax: center.lng + degrees,
    latMax: center.lat + degrees,
    latMin: center.lat - degrees,
  };
}

/**
 * Pick a Lucide-friendly emoji glyph per EONET category. Used by UI
 * surfaces that need a quick visual indicator without pulling a full
 * icon component for each category.
 */
export function eonetCategoryGlyph(categoryId: string): string {
  switch (categoryId) {
    case 'wildfires':
      return '🔥';
    case 'severeStorms':
      return '⛈️';
    case 'volcanoes':
      return '🌋';
    case 'floods':
      return '🌊';
    case 'seaLakeIce':
      return '❄️';
    case 'landslides':
      return '⛰️';
    case 'drought':
      return '☀️';
    default:
      return '📍';
  }
}
// CI retrigger 2026-05-06
