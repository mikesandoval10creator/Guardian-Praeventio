import type { BBox } from '../services/external/eonet/types';

/**
 * Pure projection helpers for the ClimateRoutes schematic. They place the REAL
 * active NASA EONET events (wildfires, storms, floods, landslides…) onto the
 * origin→destination schematic at positions derived from each event's REAL
 * coordinates within the route's real bounding box. This replaces the two
 * hard-coded fake hazard pins removed in #939 — now the markers are the actual
 * events the assessment already fetched (`RouteAssessmentResult.activeEvents`),
 * or none when there genuinely are no active events on the route.
 */

export interface SchematicDims {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Pixel box for event markers — slightly larger than the origin (100,400) /
 *  destination (700,100) waypoints so edge events stay inside the card. */
export const SCHEMATIC_DIMS: SchematicDims = { x0: 80, x1: 720, y0: 60, y1: 440 };

function firstPoint(c: unknown): { lon: number; lat: number } | null {
  if (!Array.isArray(c)) return null;
  // EONET Point geometry: [lon, lat].
  if (typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lon: c[0], lat: c[1] };
  }
  // Polygon / MultiPolygon: recurse into the first nested coordinate.
  return c.length > 0 ? firstPoint(c[0]) : null;
}

/**
 * Extract a representative [lon, lat] from an EONET event geometry array.
 * Prefers the most recent geometry entry; handles Point and nested polygon
 * coordinate shapes (both arrive as `unknown` from the loosely-typed feed).
 * Returns null when no usable coordinate exists.
 */
export function eonetEventLonLat(
  geometry: ReadonlyArray<{ coordinates?: unknown }> | undefined | null,
): { lon: number; lat: number } | null {
  if (!geometry || geometry.length === 0) return null;
  for (let i = geometry.length - 1; i >= 0; i--) {
    const pt = firstPoint(geometry[i]?.coordinates);
    if (pt && Number.isFinite(pt.lon) && Number.isFinite(pt.lat)) return pt;
  }
  return null;
}

/**
 * Project a geographic point into the schematic pixel box using the route's
 * bbox. North-up (latMax → top). Returns null for a degenerate/non-finite
 * bbox; clamps the fraction to [0,1] so a marker never renders outside the card.
 */
export function projectToSchematic(
  lon: number,
  lat: number,
  bbox: BBox,
  dims: SchematicDims = SCHEMATIC_DIMS,
): { x: number; y: number } | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const lonSpan = bbox.lonMax - bbox.lonMin;
  const latSpan = bbox.latMax - bbox.latMin;
  if (!(lonSpan > 0) || !(latSpan > 0)) return null;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const fx = clamp((lon - bbox.lonMin) / lonSpan); // 0 west → 1 east
  const fy = clamp((bbox.latMax - lat) / latSpan); // 0 north/top → 1 south/bottom
  return {
    x: dims.x0 + fx * (dims.x1 - dims.x0),
    y: dims.y0 + fy * (dims.y1 - dims.y0),
  };
}
