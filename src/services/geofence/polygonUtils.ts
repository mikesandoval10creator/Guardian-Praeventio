// Praeventio Guard — §12.6.3: Geofence polygon utility.
//
// Helper functions para visualización rica de geofences en mapas (Mapbox/
// Leaflet/GoogleMaps). Provee:
//   - Color por nivel de riesgo del polygon
//   - Centroid para tooltip placement
//   - Bounding box para auto-zoom
//   - Point-in-polygon (ray casting determinístico)
//   - Distance worker → polygon edge (warning si <buffer)
//
// Determinístico, sin LLM ni I/O. UI consumes for rendering.

export interface Coordinate {
  lat: number;
  lng: number;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'restricted';

export interface GeofencePolygon {
  /** ID único del polygon. */
  id: string;
  /** Nombre legible (e.g. "Zona Hazmat A-3"). */
  name: string;
  /** Vértices del polygon en orden (cerrado o abierto, normalizamos). */
  vertices: Coordinate[];
  /** Nivel de riesgo del área. */
  riskLevel: RiskLevel;
  /** Descripción para tooltip. */
  description?: string;
  /** Hexadecimal color override (si no, usa default por riskLevel). */
  colorOverride?: string;
  /**
   * Lista de UIDs/roles autorizados a entrar (vacío = todos pueden).
   * El render visual NO valida; lo hace el server al detectar entrada.
   */
  authorizedRoles?: string[];
}

// Colores estándar industriales (ISO 3864-1 derivado).
const RISK_COLOR_MAP: Record<RiskLevel, string> = {
  low: '#10b981',         // verde — seguro
  medium: '#fbbf24',      // amarillo — advertencia
  high: '#f97316',        // naranja — alto riesgo
  critical: '#dc2626',    // rojo — crítico
  restricted: '#7c2d12',  // marrón oscuro — prohibido
};

const RISK_FILL_OPACITY: Record<RiskLevel, number> = {
  low: 0.15,
  medium: 0.25,
  high: 0.30,
  critical: 0.35,
  restricted: 0.45,
};

const RISK_STROKE_WIDTH_PX: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 2,
  critical: 3,
  restricted: 4,
};

/**
 * Retorna estilos render-ready para el polygon (color fill + stroke + width).
 */
export function getPolygonStyle(polygon: GeofencePolygon): {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  strokeDashed: boolean;
} {
  const baseColor = polygon.colorOverride ?? RISK_COLOR_MAP[polygon.riskLevel];
  return {
    fillColor: baseColor,
    fillOpacity: RISK_FILL_OPACITY[polygon.riskLevel],
    strokeColor: baseColor,
    strokeWidth: RISK_STROKE_WIDTH_PX[polygon.riskLevel],
    // Restricted areas tienen dashed border para distinguirse visualmente
    strokeDashed: polygon.riskLevel === 'restricted',
  };
}

/**
 * Calcula el centroide del polygon usando promedio simple de vértices.
 * Útil para colocar label/tooltip en el centro visual.
 *
 * NOTA: Para polygons complejos (concavos), centroide podría caer fuera.
 * En ese caso usar polygon.label.position si está disponible.
 */
export function calculateCentroid(vertices: Coordinate[]): Coordinate {
  if (vertices.length === 0) {
    throw new Error('polygon vertices cannot be empty');
  }
  const sum = vertices.reduce(
    (acc, v) => ({ lat: acc.lat + v.lat, lng: acc.lng + v.lng }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: sum.lat / vertices.length,
    lng: sum.lng / vertices.length,
  };
}

/**
 * Calcula bounding box (min/max lat/lng) — útil para auto-zoom mapa.
 */
export interface BoundingBox {
  southwest: Coordinate;
  northeast: Coordinate;
}

export function calculateBoundingBox(vertices: Coordinate[]): BoundingBox {
  if (vertices.length === 0) {
    throw new Error('polygon vertices cannot be empty');
  }
  let minLat = vertices[0]!.lat;
  let maxLat = vertices[0]!.lat;
  let minLng = vertices[0]!.lng;
  let maxLng = vertices[0]!.lng;
  for (const v of vertices) {
    if (v.lat < minLat) minLat = v.lat;
    if (v.lat > maxLat) maxLat = v.lat;
    if (v.lng < minLng) minLng = v.lng;
    if (v.lng > maxLng) maxLng = v.lng;
  }
  return {
    southwest: { lat: minLat, lng: minLng },
    northeast: { lat: maxLat, lng: maxLng },
  };
}

/**
 * Calcula bounding box combinado de múltiples polygons. Útil para auto-zoom
 * cuando se muestran varias zonas simultáneamente.
 */
export function calculateBoundingBoxMulti(
  polygons: GeofencePolygon[],
): BoundingBox | null {
  if (polygons.length === 0) return null;
  const allVertices = polygons.flatMap((p) => p.vertices);
  return calculateBoundingBox(allVertices);
}

/**
 * Ray casting algorithm — determina si un punto está dentro de un polygon.
 *
 * Funciona para polygons convexos y concavos. Para polygons complejos
 * con self-intersections el resultado es undefined behavior (estándar).
 */
export function isPointInPolygon(
  point: Coordinate,
  vertices: Coordinate[],
): boolean {
  if (vertices.length < 3) return false;

  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const vi = vertices[i]!;
    const vj = vertices[j]!;
    const intersect =
      vi.lat > point.lat !== vj.lat > point.lat &&
      point.lng <
        ((vj.lng - vi.lng) * (point.lat - vi.lat)) / (vj.lat - vi.lat) +
          vi.lng;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Distancia Haversine entre dos coordenadas en metros.
 */
export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const R = 6_371_000; // Radio Tierra en metros
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;

  const x =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

/**
 * Encuentra la distancia mínima desde un punto al edge más cercano del
 * polygon (en metros). Si el punto está dentro, retorna 0.
 *
 * Útil para "warning de aproximación" — alertar si worker está a
 * menos de N metros del edge.
 */
export function distanceToPolygonEdge(
  point: Coordinate,
  vertices: Coordinate[],
): number {
  if (isPointInPolygon(point, vertices)) return 0;

  let minDist = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const dist = haversineMeters(point, closestPointOnSegment(point, a, b));
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

/**
 * Helper: punto más cercano en un segmento ab al punto p.
 * Proyección perpendicular si cae dentro del segmento, endpoint si no.
 */
function closestPointOnSegment(
  p: Coordinate,
  a: Coordinate,
  b: Coordinate,
): Coordinate {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return a;

  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  return {
    lat: a.lat + t * dy,
    lng: a.lng + t * dx,
  };
}

/**
 * Genera tooltip text para el polygon. Combina name + riskLevel +
 * description opcional + cantidad de roles autorizados.
 */
export function buildTooltipText(polygon: GeofencePolygon): string {
  const riskLabel: Record<RiskLevel, string> = {
    low: 'Riesgo Bajo',
    medium: 'Riesgo Medio',
    high: 'Riesgo Alto',
    critical: 'CRÍTICO',
    restricted: 'ACCESO RESTRINGIDO',
  };
  const parts: string[] = [polygon.name, riskLabel[polygon.riskLevel]];
  if (polygon.description) parts.push(polygon.description);
  if (polygon.authorizedRoles && polygon.authorizedRoles.length > 0) {
    parts.push(`Autorizados: ${polygon.authorizedRoles.join(', ')}`);
  }
  return parts.join(' · ');
}

/**
 * Calcula el área aproximada del polygon en metros cuadrados usando
 * la fórmula del polígono esférico (Spherical Excess para tierra).
 *
 * NOTA: aproximación — para polygons grandes (>1000 km²) usar lib
 * especializada como @turf/area.
 */
export function calculateAreaSquareMeters(vertices: Coordinate[]): number {
  if (vertices.length < 3) return 0;
  const R = 6_371_000;
  let total = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i]!;
    const v2 = vertices[(i + 1) % vertices.length]!;
    total +=
      ((v2.lng - v1.lng) * Math.PI) / 180 *
      (2 + Math.sin((v1.lat * Math.PI) / 180) + Math.sin((v2.lat * Math.PI) / 180));
  }
  return Math.abs((total * R * R) / 2);
}
