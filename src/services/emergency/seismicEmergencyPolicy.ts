import type { UsgsEarthquake } from '../external/usgs/types.js';

export const SEISMIC_ALERT_MIN_MAGNITUDE = 5;
export const SEISMIC_EMERGENCY_MIN_MAGNITUDE = 6;
export const SEISMIC_MAX_DISTANCE_KM = 200;
export const SEISMIC_MAX_AGE_MS = 15 * 60_000;

export interface SeismicProjectLocation {
  lat: number;
  lng: number;
}

export interface SeismicFeed {
  fetchRecentEarthquakes(options: {
    centerLat: number;
    centerLon: number;
    radiusKm: number;
    minMagnitude?: number;
    sinceHours?: number;
  }): Promise<UsgsEarthquake[]>;
}

export interface SeismicPolicyMatch {
  earthquakeId: string;
  magnitude: number;
  place: string;
  occurredAt: number;
  ageMs: number;
  distanceKm: number;
  level: 'alert' | 'emergency';
}

/**
 * Defense-in-depth validation for an upstream earthquake feature.
 *
 * The USGS query already requests a geographic radius and time window, but a
 * life-safety transition must not trust query parameters alone. We verify the
 * returned coordinates, magnitude and event time again before the UI can
 * raise an alert or trigger EmergencyContext.
 */
export function evaluateSeismicEvent(
  earthquake: UsgsEarthquake,
  projectLocation: SeismicProjectLocation,
  nowMs: number = Date.now(),
): SeismicPolicyMatch | null {
  const magnitude = earthquake.properties.mag;
  const occurredAt = earthquake.properties.time;
  const [earthquakeLng, earthquakeLat] = earthquake.geometry.coordinates;

  if (
    magnitude == null ||
    !Number.isFinite(magnitude) ||
    magnitude < SEISMIC_ALERT_MIN_MAGNITUDE ||
    !Number.isFinite(occurredAt) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(projectLocation.lat) ||
    !Number.isFinite(projectLocation.lng) ||
    !Number.isFinite(earthquakeLat) ||
    !Number.isFinite(earthquakeLng)
  ) {
    return null;
  }

  const ageMs = nowMs - occurredAt;
  if (ageMs < 0 || ageMs > SEISMIC_MAX_AGE_MS) return null;

  const distanceKm = haversineKm(
    projectLocation.lat,
    projectLocation.lng,
    earthquakeLat,
    earthquakeLng,
  );
  if (distanceKm > SEISMIC_MAX_DISTANCE_KM) return null;

  return {
    earthquakeId: earthquake.id,
    magnitude,
    place: earthquake.properties.place ?? 'ubicación no informada',
    occurredAt,
    ageMs,
    distanceKm,
    level:
      magnitude >= SEISMIC_EMERGENCY_MIN_MAGNITUDE
        ? 'emergency'
        : 'alert',
  };
}

export function findHighestPrioritySeismicEvent(
  earthquakes: UsgsEarthquake[],
  projectLocation: SeismicProjectLocation,
  nowMs: number = Date.now(),
  excludedEarthquakeIds: ReadonlySet<string> = new Set(),
): SeismicPolicyMatch | null {
  const matches = earthquakes
    .filter(earthquake => !excludedEarthquakeIds.has(earthquake.id))
    .map(earthquake => evaluateSeismicEvent(earthquake, projectLocation, nowMs))
    .filter((match): match is SeismicPolicyMatch => match !== null);

  matches.sort((left, right) => {
    if (left.level !== right.level) return left.level === 'emergency' ? -1 : 1;
    if (left.magnitude !== right.magnitude) return right.magnitude - left.magnitude;
    if (left.distanceKm !== right.distanceKm) return left.distanceKm - right.distanceKm;
    return left.ageMs - right.ageMs;
  });

  return matches[0] ?? null;
}

export async function fetchProjectSeismicEvent(
  feed: SeismicFeed,
  projectLocation: SeismicProjectLocation,
  nowMs: number = Date.now(),
  excludedEarthquakeIds: ReadonlySet<string> = new Set(),
): Promise<SeismicPolicyMatch | null> {
  const earthquakes = await feed.fetchRecentEarthquakes({
    centerLat: projectLocation.lat,
    centerLon: projectLocation.lng,
    radiusKm: SEISMIC_MAX_DISTANCE_KM,
    minMagnitude: SEISMIC_ALERT_MIN_MAGNITUDE,
    sinceHours: SEISMIC_MAX_AGE_MS / 3_600_000,
  });

  return findHighestPrioritySeismicEvent(
    earthquakes,
    projectLocation,
    nowMs,
    excludedEarthquakeIds,
  );
}

export interface ProcessProjectSeismicEventOptions {
  feed: SeismicFeed;
  projectLocation: SeismicProjectLocation;
  projectId: string;
  triggeredKeys: Set<string>;
  triggerEmergency: (type: string, projectId: string) => Promise<void>;
  nowMs?: number;
}

/** Connect the validated feed result to the project-scoped emergency path. */
export async function processProjectSeismicEvent({
  feed,
  projectLocation,
  projectId,
  triggeredKeys,
  triggerEmergency,
  nowMs = Date.now(),
}: ProcessProjectSeismicEventOptions): Promise<SeismicPolicyMatch | null> {
  const projectKeyPrefix = `${projectId}:`;
  const handledEarthquakeIds = new Set(
    [...triggeredKeys]
      .filter(key => key.startsWith(projectKeyPrefix))
      .map(key => key.slice(projectKeyPrefix.length)),
  );
  const match = await fetchProjectSeismicEvent(
    feed,
    projectLocation,
    nowMs,
    handledEarthquakeIds,
  );
  if (!match || match.level !== 'emergency') return match;

  const triggerKey = `${projectId}:${match.earthquakeId}`;
  if (triggeredKeys.has(triggerKey)) return match;

  triggeredKeys.add(triggerKey);
  try {
    await triggerEmergency('sismo', projectId);
  } catch (error) {
    // A failed call remains retryable on the next polling cycle.
    triggeredKeys.delete(triggerKey);
    throw error;
  }

  return match;
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadiusKm = 6_371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLng / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
