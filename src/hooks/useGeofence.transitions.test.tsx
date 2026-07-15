// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGeofence, type GeofenceZone } from './useGeofence';

function squareZone(
  id: string,
  minLng: number,
  maxLng: number,
): GeofenceZone {
  return {
    id,
    name: `Zona ${id}`,
    type: 'RESTRICTED',
    coordinates: [[
      [minLng, -34],
      [maxLng, -34],
      [maxLng, -33],
      [minLng, -33],
      [minLng, -34],
    ]],
  };
}

const ZONE_A = squareZone('zone-a', -71, -70);
const ZONE_B = squareZone('zone-b', -70, -69);
const OVERLAP_ZONE: GeofenceZone = {
  id: 'overlap',
  name: 'Zona overlap',
  type: 'RESTRICTED',
  coordinates: [[
    [-70.75, -34],
    [-69.25, -34],
    [-69.25, -33],
    [-70.75, -33],
    [-70.75, -34],
  ]],
};

let onPosition: PositionCallback;
const clearWatch = vi.fn();

function position(lat: number, lng: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  clearWatch.mockClear();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn((success: PositionCallback) => {
        onPosition = success;
        return 42;
      }),
      clearWatch,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGeofence active-zone transitions', () => {
  it('reports both entry and exit ticks with the actual GPS position', () => {
    const onZonesChanged = vi.fn();
    const { unmount } = renderHook(() => useGeofence([ZONE_A], onZonesChanged));

    act(() => onPosition(position(-33.5, -70.5)));
    act(() => onPosition(position(-32, -70.5)));

    expect(onZonesChanged).toHaveBeenNthCalledWith(
      1,
      [ZONE_A],
      { lat: -33.5, lng: -70.5 },
      {
        previousZoneIds: new Set(),
        currentZoneIds: new Set(['zone-a']),
        enteredZones: [ZONE_A],
        exitedZones: [],
      },
    );
    expect(onZonesChanged).toHaveBeenNthCalledWith(
      2,
      [],
      { lat: -32, lng: -70.5 },
      {
        previousZoneIds: new Set(['zone-a']),
        currentZoneIds: new Set(),
        enteredZones: [],
        exitedZones: [ZONE_A],
      },
    );

    unmount();
    expect(clearWatch).toHaveBeenCalledWith(42);
  });

  it('reports one complete transition when crossing directly between zones', () => {
    const onZonesChanged = vi.fn();
    renderHook(() =>
      useGeofence([ZONE_A, ZONE_B, OVERLAP_ZONE], onZonesChanged),
    );

    act(() => onPosition(position(-33.5, -70.5)));
    act(() => onPosition(position(-33.5, -69.5)));

    expect(onZonesChanged).toHaveBeenLastCalledWith(
      [ZONE_B, OVERLAP_ZONE],
      { lat: -33.5, lng: -69.5 },
      {
        previousZoneIds: new Set(['zone-a', 'overlap']),
        currentZoneIds: new Set(['zone-b', 'overlap']),
        enteredZones: [ZONE_B],
        exitedZones: [ZONE_A],
      },
    );
  });

  it('retains removed zone metadata long enough to report its exit', () => {
    const onZonesChanged = vi.fn();
    const { rerender } = renderHook(
      ({ zones }) => useGeofence(zones, onZonesChanged),
      { initialProps: { zones: [ZONE_A] } },
    );

    act(() => onPosition(position(-33.5, -70.5)));
    rerender({ zones: [] });
    act(() => onPosition(position(-33.5, -70.5)));

    expect(onZonesChanged).toHaveBeenLastCalledWith(
      [],
      { lat: -33.5, lng: -70.5 },
      {
        previousZoneIds: new Set(['zone-a']),
        currentZoneIds: new Set(),
        enteredZones: [],
        exitedZones: [ZONE_A],
      },
    );
  });
});
