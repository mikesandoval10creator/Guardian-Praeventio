import { describe, expect, it, vi } from 'vitest';
import type { UsgsEarthquake } from '../external/usgs/types.js';
import {
  evaluateSeismicEvent,
  fetchProjectSeismicEvent,
  findHighestPrioritySeismicEvent,
  processProjectSeismicEvent,
  SEISMIC_ALERT_MIN_MAGNITUDE,
  SEISMIC_MAX_AGE_MS,
  SEISMIC_MAX_DISTANCE_KM,
} from './seismicEmergencyPolicy.js';

const NOW = Date.parse('2026-07-12T20:00:00.000Z');
const PROJECT = { lat: -33.4489, lng: -70.6693 };

function earthquake(overrides: {
  id?: string;
  magnitude?: number | null;
  time?: number;
  lat?: number;
  lng?: number;
  place?: string;
} = {}): UsgsEarthquake {
  return {
    type: 'Feature',
    id: overrides.id ?? 'eq-1',
    properties: {
      mag: overrides.magnitude === undefined ? 6.1 : overrides.magnitude,
      place: overrides.place ?? 'Cerca de la faena',
      time: overrides.time ?? NOW - 5 * 60_000,
      type: 'earthquake',
    },
    geometry: {
      type: 'Point',
      coordinates: [overrides.lng ?? -70.7, overrides.lat ?? -33.45, 20],
    },
  };
}

describe('seismicEmergencyPolicy', () => {
  it('classifies a nearby, recent M6+ earthquake as an emergency', () => {
    const result = evaluateSeismicEvent(earthquake(), PROJECT, NOW);

    expect(result).toMatchObject({
      level: 'emergency',
      magnitude: 6.1,
      earthquakeId: 'eq-1',
    });
    expect(result?.distanceKm).toBeLessThan(10);
  });

  it('keeps a nearby, recent M5 event as an alert without triggering emergency', () => {
    const result = evaluateSeismicEvent(earthquake({ magnitude: 5.4 }), PROJECT, NOW);

    expect(result?.level).toBe('alert');
  });

  it('rejects a strong but distant earthquake', () => {
    const result = evaluateSeismicEvent(
      earthquake({ magnitude: 8.0, lat: -18.48, lng: -70.31 }),
      PROJECT,
      NOW,
    );

    expect(result).toBeNull();
  });

  it('rejects a strong but old earthquake', () => {
    const result = evaluateSeismicEvent(
      earthquake({ magnitude: 7.0, time: NOW - SEISMIC_MAX_AGE_MS - 1 }),
      PROJECT,
      NOW,
    );

    expect(result).toBeNull();
  });

  it('rejects future, malformed, and sub-threshold events', () => {
    expect(
      evaluateSeismicEvent(earthquake({ time: NOW + 1 }), PROJECT, NOW),
    ).toBeNull();
    expect(
      evaluateSeismicEvent(earthquake({ magnitude: null }), PROJECT, NOW),
    ).toBeNull();
    expect(
      evaluateSeismicEvent(earthquake({ magnitude: 4.9 }), PROJECT, NOW),
    ).toBeNull();
    expect(
      evaluateSeismicEvent(earthquake({ lat: Number.NaN }), PROJECT, NOW),
    ).toBeNull();
  });

  it('selects an emergency over a lower-priority alert regardless of feed order', () => {
    const result = findHighestPrioritySeismicEvent(
      [
        earthquake({ id: 'alert', magnitude: 5.8 }),
        earthquake({ id: 'emergency', magnitude: 6.2 }),
      ],
      PROJECT,
      NOW,
    );

    expect(result?.earthquakeId).toBe('emergency');
    expect(result?.level).toBe('emergency');
  });

  it('queries the existing USGS adapter with the same bounded policy', async () => {
    const fetchRecentEarthquakes = vi.fn().mockResolvedValue([earthquake()]);

    const result = await fetchProjectSeismicEvent(
      { fetchRecentEarthquakes },
      PROJECT,
      NOW,
    );

    expect(fetchRecentEarthquakes).toHaveBeenCalledWith({
      centerLat: PROJECT.lat,
      centerLon: PROJECT.lng,
      radiusKm: SEISMIC_MAX_DISTANCE_KM,
      minMagnitude: SEISMIC_ALERT_MIN_MAGNITUDE,
      sinceHours: SEISMIC_MAX_AGE_MS / 3_600_000,
    });
    expect(result?.level).toBe('emergency');
  });

  it('triggers the real project-scoped emergency callback for a qualifying event', async () => {
    const triggerEmergency = vi.fn().mockResolvedValue(undefined);
    const triggeredKeys = new Set<string>();

    const result = await processProjectSeismicEvent({
      feed: { fetchRecentEarthquakes: vi.fn().mockResolvedValue([earthquake()]) },
      projectLocation: PROJECT,
      projectId: 'project-1',
      triggeredKeys,
      triggerEmergency,
      nowMs: NOW,
    });

    expect(result?.level).toBe('emergency');
    expect(triggerEmergency).toHaveBeenCalledOnce();
    expect(triggerEmergency).toHaveBeenCalledWith('sismo', 'project-1');
    expect(triggeredKeys).toContain('project-1:eq-1');
  });

  it('does not trigger for alert-only events and deduplicates an emergency id', async () => {
    const triggerEmergency = vi.fn().mockResolvedValue(undefined);
    const triggeredKeys = new Set<string>();
    const feed = {
      fetchRecentEarthquakes: vi
        .fn()
        .mockResolvedValueOnce([earthquake({ magnitude: 5.5 })])
        .mockResolvedValue([earthquake()]),
    };
    const input = {
      feed,
      projectLocation: PROJECT,
      projectId: 'project-1',
      triggeredKeys,
      triggerEmergency,
      nowMs: NOW,
    };

    await processProjectSeismicEvent(input);
    await processProjectSeismicEvent(input);
    await processProjectSeismicEvent(input);

    expect(triggerEmergency).toHaveBeenCalledOnce();
  });

  it('can trigger a new event while an older handled event remains in the feed', async () => {
    const triggerEmergency = vi.fn().mockResolvedValue(undefined);
    const input = {
      feed: {
        fetchRecentEarthquakes: vi.fn().mockResolvedValue([
          earthquake({ id: 'older-stronger', magnitude: 6.5 }),
          earthquake({ id: 'new-event', magnitude: 6.1 }),
        ]),
      },
      projectLocation: PROJECT,
      projectId: 'project-1',
      triggeredKeys: new Set<string>(),
      triggerEmergency,
      nowMs: NOW,
    };

    await processProjectSeismicEvent(input);
    await processProjectSeismicEvent(input);
    await processProjectSeismicEvent(input);

    expect(triggerEmergency).toHaveBeenCalledTimes(2);
    expect(input.triggeredKeys).toEqual(
      new Set(['project-1:older-stronger', 'project-1:new-event']),
    );
  });
});
