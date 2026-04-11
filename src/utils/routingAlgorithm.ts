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
 * A simple deterministic routing algorithm (mocking A* for a grid-based or waypoint-based map).
 * In a real-world scenario, this would use a navmesh or a graph of safe paths.
 * Here, we generate a safe path by interpolating points and avoiding hazard zones.
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
    let intermediatePoint: Point = {
      lat: start.lat + (destination.lat - start.lat) * fraction,
      lng: start.lng + (destination.lng - start.lng) * fraction,
    };

    // Check if intermediate point is inside any hazard zone
    let isSafe = true;
    for (const hazard of hazards) {
      const distToHazard = calculateDistance(intermediatePoint, hazard.center);
      if (distToHazard < hazard.radius) {
        isSafe = false;
        // Simple avoidance: push the point perpendicularly away from the hazard
        const angle = Math.atan2(intermediatePoint.lat - hazard.center.lat, intermediatePoint.lng - hazard.center.lng);
        const safeDist = hazard.radius * 1.2; // 20% margin
        // Convert meters back to approx degrees (very rough approximation for small distances)
        const latOffset = (Math.sin(angle) * safeDist) / 111320;
        const lngOffset = (Math.cos(angle) * safeDist) / (111320 * Math.cos(hazard.center.lat * Math.PI / 180));
        
        intermediatePoint = {
          lat: hazard.center.lat + latOffset,
          lng: hazard.center.lng + lngOffset
        };
        break; // Handled one hazard, move on
      }
    }
    route.push(intermediatePoint);
  }
  
  route.push(destination);
  return route;
}
