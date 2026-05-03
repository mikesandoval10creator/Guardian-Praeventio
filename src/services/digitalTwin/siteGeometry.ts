// Sprint 13 — Digital Twin Phase A
// Pure helpers for site geometry (GeoJSON polygons), hazmat overlay and
// wind-suction projection. Lives outside React so the logic is unit-testable
// under the default `node` Vitest environment (no jsdom needed).
//
// Storage path (Firestore):
//   tenants/{tenantId}/projects/{projectId}/site_geometry/{geomId}
//
// All polygons follow GeoJSON RFC 7946 (lng, lat) ordering.

import { windLoadOnSurface, windSpeedKmhToMs } from '../physics/bernoulliEngine';

export type SiteGeometryType =
  | 'boundary'
  | 'hazard'
  | 'evacuation'
  | 'parking'
  | 'building';

export interface SiteGeometryProps {
  /** Stable id (uuid or Firestore doc id once persisted). */
  id: string;
  /** Human label shown in legend / tooltip. */
  label: string;
  /** Polygon classification — drives color + extrusion. */
  type: SiteGeometryType;
  /** Extrusion height in metres (only used by `building`). 0 if flat. */
  heightM: number;
  /** Free-form notes from the prevencionista. */
  notes?: string;
}

/**
 * GeoJSON `Feature<Polygon>` with our domain-specific properties.
 * We model only `Polygon` (not `MultiPolygon`) for Phase A — the click-to-add
 * editor produces a single closed ring per feature.
 */
export interface SiteGeometryFeature {
  type: 'Feature';
  id: string;
  properties: SiteGeometryProps;
  geometry: {
    type: 'Polygon';
    /** Outer ring only. Coordinates as [lng, lat]. First === last. */
    coordinates: [number, number][][];
  };
}

export interface SiteGeometryCollection {
  type: 'FeatureCollection';
  features: SiteGeometryFeature[];
}

/** Color ramp per polygon type. Used by both Maps overlay and the legend. */
export const TYPE_COLORS: Record<SiteGeometryType, string> = {
  boundary:   '#06b6d4', // cyan-500
  hazard:     '#ef4444', // red-500
  evacuation: '#22c55e', // green-500
  parking:    '#a3a3a3', // neutral-400
  building:   '#f59e0b', // amber-500
};

export const TYPE_LABELS_ES: Record<SiteGeometryType, string> = {
  boundary:   'Perímetro del sitio',
  hazard:     'Zona de peligro',
  evacuation: 'Ruta de evacuación',
  parking:    'Estacionamiento',
  building:   'Edificio',
};

/** Closes a polygon ring if the user did not (first !== last). */
export function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx === lx && fy === ly) return ring;
  return [...ring, [fx, fy]];
}

/**
 * Validate a polygon ring. Phase A rejects zero-area polygons and rings with
 * < 3 distinct points — the click editor permits free clicking but persistence
 * must refuse degenerate shapes so the visualizer never breaks.
 */
export function isValidRing(ring: [number, number][]): boolean {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  // Distinct point count (ignore the closing duplicate).
  const closed = closeRing(ring);
  const distinct = new Set(
    closed.slice(0, -1).map(([x, y]) => `${x.toFixed(8)},${y.toFixed(8)}`),
  );
  return distinct.size >= 3;
}

/** Build a `SiteGeometryFeature` from inputs. Throws on invalid ring. */
export function buildFeature(
  props: SiteGeometryProps,
  ring: [number, number][],
): SiteGeometryFeature {
  if (!isValidRing(ring)) {
    throw new Error('buildFeature: ring must have ≥3 distinct points');
  }
  return {
    type: 'Feature',
    id: props.id,
    properties: props,
    geometry: {
      type: 'Polygon',
      coordinates: [closeRing(ring)],
    },
  };
}

/** Centroid (lng, lat) of a polygon ring — used to anchor labels/markers. */
export function ringCentroid(ring: [number, number][]): [number, number] {
  if (ring.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  const closed = closeRing(ring);
  // Drop the closing duplicate so it does not double-weight a vertex.
  const pts = closed.slice(0, -1);
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return [sx / pts.length, sy / pts.length];
}

/** Severity → color mapping for risk-node markers. */
export type NodeSeverity = 'low' | 'medium' | 'high' | 'critical';
export const SEVERITY_COLORS: Record<NodeSeverity, string> = {
  low:      '#22c55e',
  medium:   '#fbbf24',
  high:     '#f97316',
  critical: '#dc2626',
};

export function severityColor(sev: string | undefined): string {
  switch ((sev ?? '').toLowerCase()) {
    case 'critical': return SEVERITY_COLORS.critical;
    case 'high':     return SEVERITY_COLORS.high;
    case 'medium':   return SEVERITY_COLORS.medium;
    case 'low':      return SEVERITY_COLORS.low;
    default:         return SEVERITY_COLORS.medium;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Wind-suction overlay
// ────────────────────────────────────────────────────────────────────────────

export interface WindSuctionInput {
  /** Hazard polygon centroid (lng, lat). */
  centroid: [number, number];
  /** Wind speed in km/h. Falls back to 0 when null/undefined. */
  windSpeedKmh: number | null | undefined;
  /**
   * Wind direction (degrees, meteorological — direction wind is coming FROM,
   * 0 = N, 90 = E). When undefined we still draw a symmetric halo at the
   * centroid (no downwind elongation).
   */
  windDirectionDeg?: number;
  /**
   * Surface area of the hazmat container exposed to wind (m²). Used by the
   * Bernoulli wind-load function to scale the "hot zone" radius.
   */
  exposedAreaM2: number;
  /** Pressure coefficient (Cp). Default −0.5 (suction on leeward face). */
  pressureCoeff?: number;
}

export interface WindSuctionOverlay {
  /**
   * Lateral force on the surface (N). Computed via `windLoadOnSurface` from
   * the existing Bernoulli engine — keeps a single source of truth for the
   * physics.
   */
  forceN: number;
  /** Halo radius in metres around the centroid (capped at 250 m). */
  hotZoneRadiusM: number;
  /**
   * Downwind anchor — projected centroid shifted by `radius/2` along the
   * wind vector. When `windDirectionDeg` is missing, equals `centroid`.
   */
  downwindAnchor: [number, number];
}

/**
 * Project a hazmat hot-zone given current wind. Used by the panel to draw a
 * red translucent ellipse downwind of each hazard polygon.
 *
 * The radius scales linearly with wind force: r = 5 + |F|/200, capped at 250 m
 * — empirical mapping picked so a 30 km/h breeze on a 4 m² tank gives ~10 m
 * (matches typical SERNAGEOMIN spill plume guidelines for low-volatility
 * hazmat at the design phase).
 */
export function projectWindSuction(input: WindSuctionInput): WindSuctionOverlay {
  const speedMs = windSpeedKmhToMs(input.windSpeedKmh ?? 0);
  const cp = input.pressureCoeff ?? -0.5;
  const forceN = windLoadOnSurface(
    Math.max(input.exposedAreaM2, 0),
    speedMs,
    cp,
  );
  const radius = Math.min(250, 5 + Math.abs(forceN) / 200);

  let anchor: [number, number] = [input.centroid[0], input.centroid[1]];
  if (typeof input.windDirectionDeg === 'number' && Number.isFinite(input.windDirectionDeg)) {
    // Convert meteorological "from" direction to "toward" radians.
    const towardRad = ((input.windDirectionDeg + 180) % 360) * (Math.PI / 180);
    // 1 deg lat ≈ 111_000 m; 1 deg lng ≈ 111_000 * cos(lat) m.
    const dxMeters = Math.sin(towardRad) * (radius / 2);
    const dyMeters = Math.cos(towardRad) * (radius / 2);
    const latRad = input.centroid[1] * (Math.PI / 180);
    const dLng = dxMeters / (111_000 * Math.max(0.01, Math.cos(latRad)));
    const dLat = dyMeters / 111_000;
    anchor = [input.centroid[0] + dLng, input.centroid[1] + dLat];
  }

  return { forceN, hotZoneRadiusM: radius, downwindAnchor: anchor };
}

/** Firestore subcollection path helper. */
export function siteGeometryPath(tenantId: string, projectId: string): string {
  return `tenants/${tenantId}/projects/${projectId}/site_geometry`;
}
