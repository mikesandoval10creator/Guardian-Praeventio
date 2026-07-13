// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGeofence, type GeofenceZone } from './useGeofence';

const ZONE: GeofenceZone = {
  id: 'zone-1',
  name: 'Zona restringida',
  type: 'RESTRICTED',
  coordinates: [[
    [-71, -34],
    [-70, -34],
    [-70, -33],
    [-71, -33],
    [-71, -34],
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
    const { unmount } = renderHook(() => useGeofence([ZONE], onZonesChanged));

    act(() => onPosition(position(-33.5, -70.5)));
    act(() => onPosition(position(-32, -70.5)));

    expect(onZonesChanged).toHaveBeenNthCalledWith(
      1,
      [ZONE],
      { lat: -33.5, lng: -70.5 },
    );
    expect(onZonesChanged).toHaveBeenNthCalledWith(
      2,
      [],
      { lat: -32, lng: -70.5 },
    );

    unmount();
    expect(clearWatch).toHaveBeenCalledWith(42);
  });
});
