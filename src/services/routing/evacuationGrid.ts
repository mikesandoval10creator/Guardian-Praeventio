// Praeventio Guard — B1 evacuation routing (2026-06).
//
// REAL evacuation pathfinding grounded in the Digital Twin. The worker
// photographs / films the worksite → photogrammetry produces the 2D site
// footprint, which the prevencionista administers as GeoJSON polygons in
// `site_geometry` (see `digitalTwin/siteGeometry.ts`):
//   - `boundary`   → the walkable extent of the site
//   - `hazard`     → danger zones (NOT walkable)
//   - `building`   → solid structures (NOT walkable)
//   - `evacuation` → safe assembly / exit zones (the goal)
//
// This module is the bridge the twin → grid → A* described by the product
// owner ("un modelo de grilla: el sitio + obstáculo + coordenada"). It
// discretizes the footprint into an N×M occupancy grid and runs the existing
// deterministic A* (`gridAStar.findPathAStar`) — replacing the Gemini
// narrative that `DynamicEvacuationMap` used to render (which produced prose,
// never real coordinates).
//
// Pure + deterministic + node-testable (no React, no Firestore, no network).
// Returns `null` HONESTLY when there is no usable geometry or the exit is
// unreachable — never a fabricated route.

import { findPathAStar, type GridCell } from './gridAStar';
import type {
  SiteGeometryFeature,
  SiteGeometryType,
} from '../digitalTwin/siteGeometry';

/** A geographic coordinate (GeoJSON ordering is lng,lat — we name them). */
export interface LngLat {
  lng: number;
  lat: number;
}

export interface GeoBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Discretized occupancy grid derived from the twin footprint. */
export interface EvacuationGrid {
  /** Occupancy matrix: cells[y][x] === 1 (obstacle) | 0 (free). */
  cells: number[][];
  cols: number;
  rows: number;
  bounds: GeoBounds;
  /** Cell extent in degrees (so a cell maps back to a lng/lat box). */
  cellLng: number;
  cellLat: number;
  /** Approximate edge length of one cell in metres (for ETA / labels). */
  cellMeters: number;
}

export interface BuildGridOptions {
  /**
   * Target number of cells along the LONGER axis. Cells are kept ~square in
   * metres (lat/lng are corrected by cos(lat)). Default 48; clamped [8, 256]
   * so a huge mine site can't blow up memory and a tiny site still has detail.
   */
  resolution?: number;
  /**
   * Which polygon types count as obstacles. Default hazard + building.
   * `boundary` is never an obstacle (it defines the walkable extent), and
   * `evacuation` is never an obstacle (it's the goal).
   */
  obstacleTypes?: SiteGeometryType[];
  /**
   * Extra point obstacles in lng/lat — e.g. areas a worker reports blocked in
   * real time. Each marks its containing cell (and is clamped into bounds).
   */
  extraBlocked?: LngLat[];
}

export interface EvacuationRoute {
  /** Ordered waypoints from the worker to the chosen exit, in lng/lat. */
  path: LngLat[];
  /** Grid-cell path (debugging / rendering). */
  cells: GridCell[];
  /** The exit (evacuation-zone) the route reaches. */
  goal: LngLat;
  /** Straight-cell length × cellMeters — a conservative distance estimate. */
  distanceMeters: number;
}

const DEFAULT_OBSTACLE_TYPES: SiteGeometryType[] = ['hazard', 'building'];
const METERS_PER_DEG_LAT = 111_320;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Outer ring of a feature ([lng,lat] pairs, closed). */
function outerRing(feature: SiteGeometryFeature): [number, number][] {
  return feature.geometry.coordinates[0] ?? [];
}

/**
 * Ray-casting point-in-polygon (even–odd rule). `ring` is [lng,lat] pairs.
 * Points exactly on an edge are treated as inside (conservative for the
 * walkable boundary; for obstacles it errs toward "blocked", which is safe).
 */
export function pointInRing(point: LngLat, ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  const { lng: px, lat: py } = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInFeature(point: LngLat, feature: SiteGeometryFeature): boolean {
  return pointInRing(point, outerRing(feature));
}

/** Union bounding box of every feature's outer ring. Null if no vertices. */
export function featuresBounds(features: SiteGeometryFeature[]): GeoBounds | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const f of features) {
    for (const [lng, lat] of outerRing(f)) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Build the occupancy grid from the twin footprint.
 *
 * Extent: the `boundary` feature(s) when present, else the union bbox of all
 * features. A cell is an obstacle when its centre is (a) outside every
 * boundary polygon, or (b) inside any obstacle-type polygon, or (c) inside an
 * `extraBlocked` cell. Returns `null` if there is no geometry to grid.
 */
export function buildEvacuationGrid(
  features: SiteGeometryFeature[],
  opts: BuildGridOptions = {},
): EvacuationGrid | null {
  if (!features || features.length === 0) return null;

  const boundaries = features.filter((f) => f.properties.type === 'boundary');
  const extentSource = boundaries.length > 0 ? boundaries : features;
  const bounds = featuresBounds(extentSource);
  if (!bounds) return null;

  const spanLng = bounds.maxLng - bounds.minLng;
  const spanLat = bounds.maxLat - bounds.minLat;
  if (spanLng <= 0 || spanLat <= 0) return null; // degenerate (line/point)

  const resolution = clamp(Math.round(opts.resolution ?? 48), 8, 256);
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const cosLat = Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const widthM = spanLng * METERS_PER_DEG_LAT * cosLat;
  const heightM = spanLat * METERS_PER_DEG_LAT;
  const cellMeters = Math.max(widthM, heightM) / resolution;
  if (!(cellMeters > 0)) return null;

  const cols = clamp(Math.ceil(widthM / cellMeters), 1, 256);
  const rows = clamp(Math.ceil(heightM / cellMeters), 1, 256);
  const cellLng = spanLng / cols;
  const cellLat = spanLat / rows;

  const obstacleTypes = new Set<SiteGeometryType>(
    opts.obstacleTypes ?? DEFAULT_OBSTACLE_TYPES,
  );
  const obstacleFeatures = features.filter((f) => obstacleTypes.has(f.properties.type));
  const hasBoundary = boundaries.length > 0;

  const cells: number[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: number[] = new Array(cols).fill(0);
    for (let x = 0; x < cols; x++) {
      const centre: LngLat = {
        lng: bounds.minLng + (x + 0.5) * cellLng,
        lat: bounds.minLat + (y + 0.5) * cellLat,
      };
      // Outside the site → not walkable.
      if (hasBoundary && !boundaries.some((b) => pointInFeature(centre, b))) {
        row[x] = 1;
        continue;
      }
      // Inside a hazard / building → not walkable.
      if (obstacleFeatures.some((o) => pointInFeature(centre, o))) {
        row[x] = 1;
      }
    }
    cells.push(row);
  }

  const grid: EvacuationGrid = { cells, cols, rows, bounds, cellLng, cellLat, cellMeters };

  // Stamp real-time blocked areas the worker reported.
  for (const blocked of opts.extraBlocked ?? []) {
    const cell = geoToCell(grid, blocked);
    grid.cells[cell.y][cell.x] = 1;
  }

  return grid;
}

/** Map a lng/lat to its grid cell, clamped into bounds. */
export function geoToCell(grid: EvacuationGrid, p: LngLat): GridCell {
  const x = clamp(
    Math.floor((p.lng - grid.bounds.minLng) / grid.cellLng),
    0,
    grid.cols - 1,
  );
  const y = clamp(
    Math.floor((p.lat - grid.bounds.minLat) / grid.cellLat),
    0,
    grid.rows - 1,
  );
  return { x, y };
}

/** Centre of a grid cell as lng/lat. */
export function cellToGeo(grid: EvacuationGrid, cell: GridCell): LngLat {
  return {
    lng: grid.bounds.minLng + (cell.x + 0.5) * grid.cellLng,
    lat: grid.bounds.minLat + (cell.y + 0.5) * grid.cellLat,
  };
}

/**
 * Nearest free cell to `cell` via an expanding ring search (BFS by Chebyshev
 * radius). Used when the worker stands inside a hazard (route them OUT) or an
 * exit centroid lands on an obstacle. Returns the cell itself if already free;
 * `null` if the whole grid is blocked.
 */
export function nearestFreeCell(grid: EvacuationGrid, cell: GridCell): GridCell | null {
  const free = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < grid.cols && y < grid.rows && grid.cells[y][x] !== 1;
  if (free(cell.x, cell.y)) return cell;
  const maxR = Math.max(grid.cols, grid.rows);
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (free(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/**
 * Plan a real evacuation route from `fromGeo` to the nearest reachable
 * evacuation zone, using A* over the twin-derived grid.
 *
 * Goals are the `evacuation` features' centroids, snapped to the nearest free
 * cell and tried in order of grid (Manhattan) proximity. Returns the route to
 * the first REACHABLE exit, or `null` when there is no geometry, no exit, or
 * no path exists — never a fabricated route.
 */
export function planEvacuationRoute(
  features: SiteGeometryFeature[],
  fromGeo: LngLat,
  opts: BuildGridOptions = {},
): EvacuationRoute | null {
  const grid = buildEvacuationGrid(features, opts);
  if (!grid) return null;

  const startRaw = geoToCell(grid, fromGeo);
  const start = nearestFreeCell(grid, startRaw);
  if (!start) return null; // entire site blocked — nothing we can do

  const exits = features.filter((f) => f.properties.type === 'evacuation');
  if (exits.length === 0) return null; // no safe zone defined → honest null

  // Candidate goal cells (snapped to free), nearest-first by Manhattan.
  const goals = exits
    .map((exit) => {
      const ring = outerRing(exit);
      const centroid = ringCentroidLngLat(ring);
      const snapped = centroid ? nearestFreeCell(grid, geoToCell(grid, centroid)) : null;
      return snapped;
    })
    .filter((c): c is GridCell => c !== null)
    .sort(
      (a, b) =>
        Math.abs(a.x - start.x) + Math.abs(a.y - start.y) -
        (Math.abs(b.x - start.x) + Math.abs(b.y - start.y)),
    );

  for (const goal of goals) {
    const cells = findPathAStar(grid.cells, start, goal);
    if (cells && cells.length > 0) {
      return {
        path: cells.map((c) => cellToGeo(grid, c)),
        cells,
        goal: cellToGeo(grid, goal),
        distanceMeters: (cells.length - 1) * grid.cellMeters,
      };
    }
  }

  return null; // no exit reachable — honest
}

/** Centroid of a [lng,lat] ring (ignores the closing duplicate). */
function ringCentroidLngLat(ring: [number, number][]): LngLat | null {
  if (ring.length === 0) return null;
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  if (pts.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const [lng, lat] of pts) {
    sx += lng;
    sy += lat;
  }
  return { lng: sx / pts.length, lat: sy / pts.length };
}
