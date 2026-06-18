import { describe, it, expect } from 'vitest';
import {
  eonetEventLonLat,
  projectToSchematic,
  SCHEMATIC_DIMS,
} from './climateRouteSchematic';
import type { BBox } from '../services/external/eonet/types';

// Route across central Chile, north-up.
const BBOX: BBox = { lonMin: -71, lonMax: -70, latMin: -34, latMax: -33 };

describe('eonetEventLonLat', () => {
  it('reads a Point geometry [lon, lat]', () => {
    expect(eonetEventLonLat([{ coordinates: [-70.5, -33.5] }])).toEqual({ lon: -70.5, lat: -33.5 });
  });

  it('prefers the most recent geometry entry', () => {
    expect(
      eonetEventLonLat([
        { coordinates: [-70.9, -33.9] },
        { coordinates: [-70.1, -33.1] },
      ]),
    ).toEqual({ lon: -70.1, lat: -33.1 });
  });

  it('extracts the first vertex of a polygon (nested arrays)', () => {
    expect(
      eonetEventLonLat([{ coordinates: [[[-70.5, -33.5], [-70.4, -33.4]]] }]),
    ).toEqual({ lon: -70.5, lat: -33.5 });
  });

  it('returns null for empty / missing / non-numeric geometry', () => {
    expect(eonetEventLonLat([])).toBeNull();
    expect(eonetEventLonLat(undefined)).toBeNull();
    expect(eonetEventLonLat(null)).toBeNull();
    expect(eonetEventLonLat([{ coordinates: 'nope' }])).toBeNull();
    expect(eonetEventLonLat([{ coordinates: ['a', 'b'] }])).toBeNull();
  });
});

describe('projectToSchematic', () => {
  it('maps the bbox center to the schematic center', () => {
    const p = projectToSchematic(-70.5, -33.5, BBOX);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo((SCHEMATIC_DIMS.x0 + SCHEMATIC_DIMS.x1) / 2);
    expect(p!.y).toBeCloseTo((SCHEMATIC_DIMS.y0 + SCHEMATIC_DIMS.y1) / 2);
  });

  it('maps the north-west corner to the top-left (north-up)', () => {
    const p = projectToSchematic(-71, -33, BBOX); // westmost lon, northmost lat
    expect(p!.x).toBeCloseTo(SCHEMATIC_DIMS.x0);
    expect(p!.y).toBeCloseTo(SCHEMATIC_DIMS.y0);
  });

  it('maps the south-east corner to the bottom-right', () => {
    const p = projectToSchematic(-70, -34, BBOX); // eastmost lon, southmost lat
    expect(p!.x).toBeCloseTo(SCHEMATIC_DIMS.x1);
    expect(p!.y).toBeCloseTo(SCHEMATIC_DIMS.y1);
  });

  it('clamps out-of-bbox points into the box instead of overflowing', () => {
    const p = projectToSchematic(-80, -20, BBOX); // far west + far north
    expect(p!.x).toBe(SCHEMATIC_DIMS.x0);
    expect(p!.y).toBe(SCHEMATIC_DIMS.y0);
  });

  it('returns null for a degenerate or non-finite bbox/point', () => {
    expect(projectToSchematic(-70.5, -33.5, { lonMin: -70, lonMax: -70, latMin: -34, latMax: -33 })).toBeNull();
    expect(projectToSchematic(Number.NaN, -33.5, BBOX)).toBeNull();
  });
});
