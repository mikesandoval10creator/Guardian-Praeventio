// B1 — evacuation routing over the Digital Twin footprint.
//
// Proves the twin→grid→A* bridge actually pathfinds: the route avoids hazard
// and building polygons, reaches an evacuation zone, routes a worker OUT of a
// hazard, honours real-time blocked areas, and returns null HONESTLY when the
// exit is walled off or no geometry / exit exists. No fabricated routes.

import { describe, it, expect } from 'vitest';
import {
  buildEvacuationGrid,
  planEvacuationRoute,
  pointInRing,
  geoToCell,
  cellToGeo,
  nearestFreeCell,
  featuresBounds,
  type LngLat,
} from './evacuationGrid';
import type { SiteGeometryFeature, SiteGeometryType } from '../digitalTwin/siteGeometry';

// ── Test geometry helpers ───────────────────────────────────────────────────
// Square site near the equator (cosLat≈1) so degrees map cleanly to metres.
// 0..0.001 deg ≈ 111 m per axis. With resolution 20 → 20×20 grid, ~5.5 m cells.

let idSeq = 0;
function feature(
  type: SiteGeometryType,
  ring: [number, number][],
  label = type,
): SiteGeometryFeature {
  idSeq += 1;
  const id = `f${idSeq}`;
  // close the ring
  const closed: [number, number][] =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
  return {
    type: 'Feature',
    id,
    properties: { id, label, type, heightM: 0 },
    geometry: { type: 'Polygon', coordinates: [closed] },
  };
}

const BOUNDARY = feature('boundary', [
  [0, 0],
  [0.001, 0],
  [0.001, 0.001],
  [0, 0.001],
]);

const EXIT = feature('evacuation', [
  [0.0008, 0.0008],
  [0.001, 0.0008],
  [0.001, 0.001],
  [0.0008, 0.001],
]);

// Worker bottom-left, exit top-right.
const WORKER: LngLat = { lng: 0.0001, lat: 0.0001 };

// A wall band across lat 0.0003..0.0007.
const partialWall = feature('hazard', [
  [0, 0.0003],
  [0.0007, 0.0003], // leaves a gap for lng > 0.0007
  [0.0007, 0.0007],
  [0, 0.0007],
]);
const fullWall = feature('hazard', [
  [0, 0.0003],
  [0.001, 0.0003], // spans the whole width — no passage
  [0.001, 0.0007],
  [0, 0.0007],
]);

const OPTS = { resolution: 20 };

describe('pointInRing', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  it('detects interior and exterior points', () => {
    expect(pointInRing({ lng: 5, lat: 5 }, square)).toBe(true);
    expect(pointInRing({ lng: 15, lat: 5 }, square)).toBe(false);
    expect(pointInRing({ lng: -1, lat: -1 }, square)).toBe(false);
  });
  it('returns false for a degenerate ring', () => {
    expect(pointInRing({ lng: 0, lat: 0 }, [[0, 0], [1, 1]])).toBe(false);
  });
});

describe('featuresBounds', () => {
  it('computes the union bounding box', () => {
    const b = featuresBounds([BOUNDARY, EXIT]);
    expect(b).toEqual({ minLng: 0, minLat: 0, maxLng: 0.001, maxLat: 0.001 });
  });
  it('returns null when there are no vertices', () => {
    expect(featuresBounds([])).toBeNull();
  });
});

describe('buildEvacuationGrid', () => {
  it('returns null without geometry', () => {
    expect(buildEvacuationGrid([], OPTS)).toBeNull();
  });

  it('marks hazard cells as obstacles and open cells as free', () => {
    const grid = buildEvacuationGrid([BOUNDARY, partialWall, EXIT], OPTS)!;
    expect(grid).not.toBeNull();
    expect(grid.cols).toBe(20);
    expect(grid.rows).toBe(20);

    // A point inside the wall band, left of the gap → obstacle.
    const inWall = geoToCell(grid, { lng: 0.0002, lat: 0.0005 });
    expect(grid.cells[inWall.y][inWall.x]).toBe(1);

    // The gap on the right of the wall band → free.
    const inGap = geoToCell(grid, { lng: 0.00085, lat: 0.0005 });
    expect(grid.cells[inGap.y][inGap.x]).toBe(0);

    // Open ground near the worker → free.
    const open = geoToCell(grid, WORKER);
    expect(grid.cells[open.y][open.x]).toBe(0);
  });

  it('treats area outside the boundary as not walkable', () => {
    // L-shaped boundary: the top-right quadrant is inside the bbox but OUTSIDE
    // the polygon, so it must be marked non-walkable.
    const lBoundary = feature('boundary', [
      [0, 0],
      [0.001, 0],
      [0.001, 0.0005],
      [0.0005, 0.0005],
      [0.0005, 0.001],
      [0, 0.001],
    ]);
    const grid = buildEvacuationGrid([lBoundary], OPTS)!;
    // Top-right quadrant — inside bbox, outside the L → obstacle.
    const outside = geoToCell(grid, { lng: 0.0009, lat: 0.0009 });
    expect(grid.cells[outside.y][outside.x]).toBe(1);
    // Bottom-right — inside the L → free.
    const inside = geoToCell(grid, { lng: 0.0009, lat: 0.0002 });
    expect(grid.cells[inside.y][inside.x]).toBe(0);
  });

  it('stamps extra real-time blocked areas as obstacles', () => {
    const blocked: LngLat = { lng: 0.00085, lat: 0.0005 }; // normally free (the gap)
    const grid = buildEvacuationGrid([BOUNDARY, partialWall, EXIT], {
      ...OPTS,
      extraBlocked: [blocked],
    })!;
    const cell = geoToCell(grid, blocked);
    expect(grid.cells[cell.y][cell.x]).toBe(1);
  });
});

describe('geoToCell / cellToGeo', () => {
  it('round-trips a coordinate back to within one cell', () => {
    const grid = buildEvacuationGrid([BOUNDARY], OPTS)!;
    const cell = geoToCell(grid, WORKER);
    const back = cellToGeo(grid, cell);
    expect(Math.abs(back.lng - WORKER.lng)).toBeLessThanOrEqual(grid.cellLng);
    expect(Math.abs(back.lat - WORKER.lat)).toBeLessThanOrEqual(grid.cellLat);
  });
  it('clamps out-of-bounds points into the grid', () => {
    const grid = buildEvacuationGrid([BOUNDARY], OPTS)!;
    const cell = geoToCell(grid, { lng: 99, lat: 99 });
    expect(cell.x).toBe(grid.cols - 1);
    expect(cell.y).toBe(grid.rows - 1);
  });
});

describe('nearestFreeCell', () => {
  it('returns the cell itself when already free', () => {
    const grid = buildEvacuationGrid([BOUNDARY, partialWall, EXIT], OPTS)!;
    const free = geoToCell(grid, WORKER);
    expect(nearestFreeCell(grid, free)).toEqual(free);
  });
  it('finds an adjacent free cell when the target is an obstacle', () => {
    const grid = buildEvacuationGrid([BOUNDARY, partialWall, EXIT], OPTS)!;
    const blocked = geoToCell(grid, { lng: 0.0002, lat: 0.0005 });
    expect(grid.cells[blocked.y][blocked.x]).toBe(1);
    const free = nearestFreeCell(grid, blocked)!;
    expect(free).not.toBeNull();
    expect(grid.cells[free.y][free.x]).toBe(0);
  });
});

describe('planEvacuationRoute', () => {
  it('routes AROUND a hazard wall through the gap, never crossing the danger zone', () => {
    const features = [BOUNDARY, partialWall, EXIT];
    const route = planEvacuationRoute(features, WORKER, OPTS)!;
    expect(route).not.toBeNull();
    expect(route.path.length).toBeGreaterThan(2);

    // The KEY safety invariant: no waypoint is inside the hazard polygon.
    const hazardRing = partialWall.geometry.coordinates[0];
    for (const p of route.path) {
      expect(pointInRing(p, hazardRing)).toBe(false);
    }

    // The route must use the gap (lng > 0.0007 somewhere as it crosses the band).
    const crossesViaGap = route.path.some(
      (p) => p.lat >= 0.0003 && p.lat <= 0.0007 && p.lng > 0.0007,
    );
    expect(crossesViaGap).toBe(true);

    // It ends at the evacuation zone.
    expect(pointInRing(route.goal, EXIT.geometry.coordinates[0])).toBe(true);
    expect(route.distanceMeters).toBeGreaterThan(0);
  });

  it('returns null HONESTLY when the exit is walled off (no fabricated route)', () => {
    const features = [BOUNDARY, fullWall, EXIT];
    expect(planEvacuationRoute(features, WORKER, OPTS)).toBeNull();
  });

  it('returns null when there is no evacuation zone defined', () => {
    const features = [BOUNDARY, partialWall];
    expect(planEvacuationRoute(features, WORKER, OPTS)).toBeNull();
  });

  it('returns null when there is no geometry at all', () => {
    expect(planEvacuationRoute([], WORKER, OPTS)).toBeNull();
  });

  it('routes a worker who is standing INSIDE a hazard out to safety', () => {
    const features = [BOUNDARY, partialWall, EXIT];
    const insideHazard: LngLat = { lng: 0.0002, lat: 0.0005 };
    const route = planEvacuationRoute(features, insideHazard, OPTS)!;
    expect(route).not.toBeNull();
    // First waypoint is already on safe ground (snapped out of the hazard).
    expect(pointInRing(route.path[0], partialWall.geometry.coordinates[0])).toBe(false);
    expect(pointInRing(route.goal, EXIT.geometry.coordinates[0])).toBe(true);
  });
});
