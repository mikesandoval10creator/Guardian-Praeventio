/**
 * Represents a coordinate point.
 */
export interface Point {
  lat: number;
  lng: number;
}

/**
 * Represents a hazard zone to avoid.
 */
export interface HazardZone {
  center: Point;
  radius: number; // in meters
}

/**
 * Calculates the distance between two coordinates in meters using the Haversine formula.
 */
export function calculateDistance(p1: Point, p2: Point): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (p1.lat * Math.PI) / 180;
  const φ2 = (p2.lat * Math.PI) / 180;
  const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
  const Δλ = ((p2.lng - p1.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * 🛟 Reubica un punto fuera de TODOS los peligros que lo contienen.
 *
 * El impl previo esquivaba solo el PRIMER peligro (`break`) y no re-chequeaba
 * el punto reubicado, así que la ruta de evacuación podía dejar un waypoint
 * dentro de un segundo peligro (un trabajador no puede ser enrutado a través
 * de un peligro). Esta versión empuja el punto al anillo seguro del peligro
 * violado y RE-CHEQUEA contra todos, iterando hasta librarlos o agotar
 * `maxIterations` (cota dura: evita bucle infinito ante geometría imposible).
 *
 * Determinista (sin `Math.random`); el empuje usa el mismo modelo (anillo a
 * 1.2× del radio) que la versión original — un solo peligro se comporta igual.
 */
export function clearPointFromHazards(
  point: Point,
  hazards: HazardZone[],
  maxIterations = 12
): Point {
  let p = point;
  for (let iter = 0; iter < maxIterations; iter++) {
    const violating = hazards.find(
      (h) => calculateDistance(p, h.center) < h.radius
    );
    if (!violating) return p; // libre de todos los peligros
    const angle = Math.atan2(
      p.lat - violating.center.lat,
      p.lng - violating.center.lng
    );
    const safeDist = violating.radius * 1.2; // 20% de margen
    const latOffset = (Math.sin(angle) * safeDist) / 111320;
    const lngOffset =
      (Math.cos(angle) * safeDist) /
      (111320 * Math.cos((violating.center.lat * Math.PI) / 180));
    p = {
      lat: violating.center.lat + latOffset,
      lng: violating.center.lng + lngOffset,
    };
  }
  return p; // best-effort tras la cota (geometría irresoluble)
}

/**
 * A simple deterministic routing algorithm.
 * Generates a safe path by interpolating points and avoiding hazard zones.
 *
 * NOTA (deuda rastreada, TODO §2.32): los endpoints (start/destination) no se
 * reubican — el trabajador está EN start y el punto de reunión es fijo; el
 * caller debe validar endpoints por separado. Pendiente: verificar que los
 * SEGMENTOS entre waypoints no crucen un peligro (no solo los vértices).
 */
export function calculateDeterministicSafeRoute(
  start: Point,
  destination: Point,
  hazards: HazardZone[]
): Point[] {
  const route: Point[] = [start];

  // Basic interpolation (10 steps)
  const steps = 10;
  for (let i = 1; i < steps; i++) {
    const fraction = i / steps;
    const interpolated: Point = {
      lat: start.lat + (destination.lat - start.lat) * fraction,
      lng: start.lng + (destination.lng - start.lng) * fraction,
    };
    // Reubica fuera de TODOS los peligros (no solo el primero), con re-chequeo.
    route.push(clearPointFromHazards(interpolated, hazards));
  }

  route.push(destination);
  return route;
}
