// Praeventio Guard — OLA 1: RestrictedZone → GeofenceZone adapter.
//
// The audited zone CRUD route (`/api/zones/by-site/:projectId`, server
// `routes/restrictedZones.ts`) persists `RestrictedZone`s
// (`services/zones/restrictedZonesEngine.ts`). The on-device geofence alert
// (`components/emergency/GeofenceAlert.tsx` → `useGeofenceWithEvents`) consumes
// `GeofenceZone`s. This pure adapter bridges the two so the client can render
// REAL configured zones instead of the DEV-only fabricated demo polygon.
//
// Deterministic, no I/O — unit-testable in isolation.

import type { GeofenceZone } from '../../hooks/useGeofence';
import type { RestrictedZone, ZoneKind } from './restrictedZonesEngine';

// Map the 8 operational zone kinds onto the 3 geofence alert severities.
// The geofence `type` only drives the alert label/severity; the legal rules
// (EPP/training/permit) live on the RestrictedZone and are evaluated by the
// server `checkZoneEntry` engine, not here.
const KIND_TO_TYPE: Record<ZoneKind, GeofenceZone['type']> = {
  atex: 'HAZMAT', // explosive atmosphere
  biohazard: 'HAZMAT',
  hot: 'DANGER', // hot work
  high_voltage: 'DANGER',
  lifting: 'DANGER', // active lifting overhead
  heavy_traffic: 'DANGER',
  confined: 'RESTRICTED', // confined space — entry gated
  exclusion: 'RESTRICTED', // total exclusion
};

/**
 * Closes a polygon ring (GeoJSON requires first === last). Returns the ring
 * unchanged if already closed or too short to close.
 */
function closeRing(ring: Array<[number, number]>): Array<[number, number]> {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

/**
 * Adapts one `RestrictedZone` to a `GeofenceZone`, or returns null when it
 * cannot be geofenced (no perimeter, or a degenerate <3-point perimeter).
 * GPS geofencing is impossible without a polygon, so such a zone is skipped
 * rather than rendered as a zero-area phantom.
 */
export function restrictedZoneToGeofenceZone(zone: RestrictedZone): GeofenceZone | null {
  const perimeter = zone.perimeter;
  if (!perimeter || perimeter.length < 3) return null;
  const ring = closeRing(perimeter);
  // A GeoJSON LinearRing needs >= 4 positions; @turf/helpers' polygon() throws
  // "Each LinearRing of a Polygon must have 4 or more Positions" otherwise, and
  // useGeofence swallows that throw (returns false) — silently dropping the zone
  // from geofencing. A degenerate perimeter (e.g. 3 points already closed, i.e.
  // only 2 distinct vertices) can't form a polygon, so skip it honestly here.
  if (ring.length < 4) return null;
  return {
    id: zone.id,
    name: zone.name,
    type: KIND_TO_TYPE[zone.kind] ?? 'RESTRICTED',
    coordinates: [ring],
  };
}

/**
 * Whether a zone's restriction is in force at `now`. A not-yet-active or
 * expired zone carries no entry restriction (mirrors `checkZoneEntry`), so it
 * must NOT raise a geofence alert.
 */
export function isZoneActiveNow(zone: RestrictedZone, now: Date): boolean {
  const t = now.getTime();
  if (Number.isNaN(Date.parse(zone.activeFrom)) || Date.parse(zone.activeFrom) > t) return false;
  if (zone.activeUntil) {
    const until = Date.parse(zone.activeUntil);
    if (!Number.isNaN(until) && until < t) return false;
  }
  return true;
}

/**
 * Maps the active, geofence-able subset of `zones` to `GeofenceZone`s. Inactive
 * (not-yet/expired) zones and zones without a usable perimeter are dropped.
 */
export function mapActiveRestrictedZones(
  zones: RestrictedZone[],
  now: Date = new Date(),
): GeofenceZone[] {
  const out: GeofenceZone[] = [];
  for (const zone of zones) {
    if (!isZoneActiveNow(zone, now)) continue;
    const mapped = restrictedZoneToGeofenceZone(zone);
    if (mapped) out.push(mapped);
  }
  return out;
}
