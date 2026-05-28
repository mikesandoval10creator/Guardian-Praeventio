// Tests §12.6.3 — Geofence polygon utility.

import { describe, it, expect } from 'vitest';
import {
  getPolygonStyle,
  calculateCentroid,
  calculateBoundingBox,
  calculateBoundingBoxMulti,
  isPointInPolygon,
  haversineMeters,
  distanceToPolygonEdge,
  buildTooltipText,
  calculateAreaSquareMeters,
  type GeofencePolygon,
} from './polygonUtils';

// Polígono rectangular Santiago test (~10×10 m)
const square: GeofencePolygon = {
  id: 'sq1',
  name: 'Zona Test',
  riskLevel: 'medium',
  vertices: [
    { lat: -33.4500, lng: -70.6500 },
    { lat: -33.4501, lng: -70.6500 },
    { lat: -33.4501, lng: -70.6499 },
    { lat: -33.4500, lng: -70.6499 },
  ],
};

describe('getPolygonStyle', () => {
  it('color por risk level', () => {
    expect(getPolygonStyle({ ...square, riskLevel: 'low' }).fillColor).toBe('#10b981');
    expect(getPolygonStyle({ ...square, riskLevel: 'critical' }).fillColor).toBe('#dc2626');
  });

  it('restricted → dashed border', () => {
    expect(getPolygonStyle({ ...square, riskLevel: 'restricted' }).strokeDashed).toBe(true);
    expect(getPolygonStyle({ ...square, riskLevel: 'low' }).strokeDashed).toBe(false);
  });

  it('colorOverride toma prioridad', () => {
    const custom = getPolygonStyle({ ...square, colorOverride: '#abcdef' });
    expect(custom.fillColor).toBe('#abcdef');
  });

  it('strokeWidth escalado por riesgo', () => {
    expect(getPolygonStyle({ ...square, riskLevel: 'low' }).strokeWidth).toBe(1);
    expect(getPolygonStyle({ ...square, riskLevel: 'restricted' }).strokeWidth).toBe(4);
  });
});

describe('calculateCentroid', () => {
  it('rectangle centroid', () => {
    const c = calculateCentroid(square.vertices);
    expect(c.lat).toBeCloseTo(-33.45005, 4);
    expect(c.lng).toBeCloseTo(-70.64995, 4);
  });

  it('rechaza vértices vacíos', () => {
    expect(() => calculateCentroid([])).toThrow();
  });
});

describe('calculateBoundingBox', () => {
  it('SW + NE para rectangle', () => {
    const bbox = calculateBoundingBox(square.vertices);
    expect(bbox.southwest.lat).toBe(-33.4501);
    expect(bbox.southwest.lng).toBe(-70.6500);
    expect(bbox.northeast.lat).toBe(-33.4500);
    expect(bbox.northeast.lng).toBe(-70.6499);
  });

  it('rechaza vértices vacíos', () => {
    expect(() => calculateBoundingBox([])).toThrow();
  });
});

describe('calculateBoundingBoxMulti', () => {
  it('combina múltiples polygons', () => {
    const p2: GeofencePolygon = {
      ...square,
      id: 'p2',
      vertices: [
        { lat: -33.5000, lng: -70.7000 },
        { lat: -33.5001, lng: -70.7000 },
      ],
    };
    const bbox = calculateBoundingBoxMulti([square, p2]);
    expect(bbox?.southwest.lat).toBe(-33.5001);
    expect(bbox?.northeast.lat).toBe(-33.4500);
  });

  it('array vacío → null', () => {
    expect(calculateBoundingBoxMulti([])).toBeNull();
  });
});

describe('isPointInPolygon', () => {
  it('punto interior → true', () => {
    expect(
      isPointInPolygon({ lat: -33.45005, lng: -70.64995 }, square.vertices),
    ).toBe(true);
  });

  it('punto exterior → false', () => {
    expect(
      isPointInPolygon({ lat: -33.4000, lng: -70.6000 }, square.vertices),
    ).toBe(false);
  });

  it('polygon con <3 vértices → false', () => {
    expect(
      isPointInPolygon({ lat: 0, lng: 0 }, [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]),
    ).toBe(false);
  });
});

describe('haversineMeters', () => {
  it('punto consigo mismo → 0', () => {
    const p = { lat: -33.45, lng: -70.65 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it('Santiago Centro a Santiago Bellavista (~3 km)', () => {
    const centro = { lat: -33.4378, lng: -70.6505 };
    const bellavista = { lat: -33.4255, lng: -70.6353 };
    const dist = haversineMeters(centro, bellavista);
    expect(dist).toBeGreaterThan(1_500);
    expect(dist).toBeLessThan(3_000);
  });

  it('Cordillera a océano (~100 km aprox Santiago)', () => {
    const cordillera = { lat: -33.41, lng: -70.10 };
    const valparaiso = { lat: -33.04, lng: -71.62 };
    const dist = haversineMeters(cordillera, valparaiso);
    expect(dist).toBeGreaterThan(100_000);
    expect(dist).toBeLessThan(200_000);
  });
});

describe('distanceToPolygonEdge', () => {
  it('punto dentro → 0', () => {
    expect(
      distanceToPolygonEdge({ lat: -33.45005, lng: -70.64995 }, square.vertices),
    ).toBe(0);
  });

  it('punto cerca del edge → distancia pequeña en metros', () => {
    // Punto ~1m sur del polygon
    const dist = distanceToPolygonEdge(
      { lat: -33.45015, lng: -70.64995 }, // poco más al sur
      square.vertices,
    );
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(100);
  });

  it('punto lejano → distancia grande', () => {
    const dist = distanceToPolygonEdge(
      { lat: -33.5000, lng: -70.7500 }, // ~10 km
      square.vertices,
    );
    expect(dist).toBeGreaterThan(1_000);
  });
});

describe('buildTooltipText', () => {
  it('combina name + riskLevel', () => {
    const text = buildTooltipText({ ...square, riskLevel: 'critical' });
    expect(text).toContain('Zona Test');
    expect(text).toContain('CRÍTICO');
  });

  it('incluye description si presente', () => {
    const text = buildTooltipText({ ...square, description: 'Almacén hazmat' });
    expect(text).toContain('Almacén hazmat');
  });

  it('incluye authorizedRoles', () => {
    const text = buildTooltipText({
      ...square,
      authorizedRoles: ['supervisor', 'brigada'],
    });
    expect(text).toContain('Autorizados: supervisor, brigada');
  });
});

describe('calculateAreaSquareMeters', () => {
  it('rectangle Santiago ~10×10m', () => {
    const area = calculateAreaSquareMeters(square.vertices);
    expect(area).toBeGreaterThan(50);
    expect(area).toBeLessThan(200);
  });

  it('polygon <3 vértices → 0', () => {
    expect(calculateAreaSquareMeters([{ lat: 0, lng: 0 }])).toBe(0);
  });
});
