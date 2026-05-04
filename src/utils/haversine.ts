// SPDX-License-Identifier: MIT
//
// Haversine distance — great-circle distance between two lat/lng points
// expressed in metres. Pure module: no I/O, no React, no Firebase.
//
// Used by the geo-anchored ZK retrieval pipeline (Bucket K) to filter
// candidate nodes returned by a Firestore bounding-box query down to a
// true radius. Firestore range queries can only filter on a single
// indexed field at a time (lat, in our case); the longitude axis and
// the actual circular geofence are enforced client-side here.
//
// Numerical notes:
//   - Earth radius taken as the WGS-84 mean radius (6,371,000 m). Good
//     enough for safety control material proximity (we care about
//     "within 50 m of the extintor", not centimetric precision).
//   - The asin form is numerically stable for short distances; switching
//     to atan2 buys nothing within a single project's bounding box but
//     loses readability.
//   - Inputs in DEGREES — caller doesn't have to pre-convert.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Great-circle distance between two `{lat, lng}` points, in metres.
 *
 * Symmetric (`haversineMeters(a, b) === haversineMeters(b, a)`), zero
 * when both points coincide, and well-behaved across the equator and
 * the antimeridian (sin/cos handle the wrap automatically).
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aa =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  // Clamp `aa` to [0,1] before asin: floating-point noise can push it
  // microscopically above 1 for nearly-antipodal points and yield NaN.
  const clamped = Math.min(1, Math.max(0, aa));
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(clamped));
}

/**
 * Compute a (latMin, latMax, lngMin, lngMax) bounding box around `center`
 * that is guaranteed to contain every point within `radiusM` metres.
 *
 * Used to drive a Firestore range query on `metadata.geo.lat` (single
 * inequality), with a finer Haversine filter applied client-side after.
 *
 * The latitude delta is exact (1° lat ≈ 111_320 m). The longitude delta
 * uses `cos(lat)` correction so the box stays tight outside the equator
 * — at higher latitudes the same metre-delta covers more degrees.
 *
 * Pole guard: clamping cos to a small floor (1e-6) prevents division
 * blowups; in practice Chilean faenas never need this branch but the
 * project also serves Antarctica research stations long-term.
 */
export function boundingBox(
  center: LatLng,
  radiusM: number,
): { latMin: number; latMax: number; lngMin: number; lngMax: number } {
  const latDelta = (radiusM / 111_320);
  const cosLat = Math.max(Math.cos(center.lat * DEG_TO_RAD), 1e-6);
  const lngDelta = radiusM / (111_320 * cosLat);
  return {
    latMin: center.lat - latDelta,
    latMax: center.lat + latDelta,
    lngMin: center.lng - lngDelta,
    lngMax: center.lng + lngDelta,
  };
}
