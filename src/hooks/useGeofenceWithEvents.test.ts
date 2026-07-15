// @vitest-environment jsdom
//
// OLA 1 (VIDA, 2026-06-14) — useGeofenceWithEvents now has a real prod consumer
// (GeofenceAlert), so its escalation-emit wiring is pinned here. Entering a
// HAZMAT/RESTRICTED zone must emit a `geofence_crossed` "enter" event onto the
// SystemEngine bus (→ geofenceToSosPolicy → recommend/notify supervisors), and
// leaving a previously-inside zone must emit "exit" exactly once (no re-emit of
// "enter" for a zone we're still inside).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GeofenceTransition } from './useGeofence';

interface Position {
  lat: number;
  lng: number;
}

// Capture the active-zone callback that useGeofenceWithEvents passes into the
// low-level useGeofence (stubbed here — GPS is covered by its own hook test).
let capturedOnZonesChanged:
  | ((
      zones: unknown[],
      position: Position | undefined,
      transition: GeofenceTransition,
    ) => void)
  | null = null;
vi.mock('./useGeofence', () => ({
  useGeofence: (
    _zones: unknown,
    onZonesChanged: (
      zones: unknown[],
      position: Position | undefined,
      transition: GeofenceTransition,
    ) => void,
  ) => {
    capturedOnZonesChanged = onZonesChanged;
    return { currentLocation: null, activeZones: [], permissionState: 'granted' };
  },
}));

const emitMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../services/systemEngine/eventLog', () => ({
  emit: (...args: unknown[]) => emitMock(...args),
  buildEnvelope: (o: Record<string, unknown>) => ({ ...o }),
}));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { useGeofenceWithEvents } from './useGeofenceWithEvents';

const zone = (id: string) => ({
  id,
  name: `Zona ${id}`,
  type: 'HAZMAT' as const,
  coordinates: [] as [number, number][][],
});
const OPTS = { tenantId: 't1', projectId: 'p1', workerId: 'w1' };
const ENTER_POSITION = { lat: -33.4489, lng: -70.6693 };
const EXIT_POSITION = { lat: -33.45, lng: -70.67 };

type Zone = ReturnType<typeof zone>;

function transition(
  previousIds: string[],
  currentIds: string[],
  enteredZones: Zone[],
  exitedZones: Zone[],
): GeofenceTransition {
  return {
    previousZoneIds: new Set(previousIds),
    currentZoneIds: new Set(currentIds),
    enteredZones,
    exitedZones,
  };
}

describe('useGeofenceWithEvents — escalation emit wiring', () => {
  beforeEach(() => {
    capturedOnZonesChanged = null;
    emitMock.mockClear();
  });

  it('emits geofence_crossed "enter" with real GPS + forwards the new entry', async () => {
    const onEntry = vi.fn();
    const z1 = zone('z1');
    renderHook(() => useGeofenceWithEvents([z1], OPTS, onEntry));
    expect(capturedOnZonesChanged).toBeTruthy();

    capturedOnZonesChanged!(
      [z1],
      ENTER_POSITION,
      transition([], ['z1'], [z1], []),
    );
    await Promise.resolve();

    expect(emitMock).toHaveBeenCalledTimes(1);
    const ev = emitMock.mock.calls[0]![0] as { type: string; payload: Record<string, unknown> };
    expect(ev.type).toBe('geofence_crossed');
    expect(ev.payload).toMatchObject({
      zoneId: 'z1',
      direction: 'enter',
      workerId: 'w1',
      projectId: 'p1',
      lat: ENTER_POSITION.lat,
      lng: ENTER_POSITION.lng,
    });
    expect(onEntry).toHaveBeenCalledWith([z1]);
  });

  it('does NOT re-emit "enter" for a zone the worker is still inside', async () => {
    const z1 = zone('z1');
    renderHook(() => useGeofenceWithEvents([z1], OPTS));
    capturedOnZonesChanged!(
      [z1],
      ENTER_POSITION,
      transition([], ['z1'], [z1], []),
    );
    await Promise.resolve();
    emitMock.mockClear();

    // Still inside z1 on the next geofence tick → no new emit.
    capturedOnZonesChanged!(
      [z1],
      ENTER_POSITION,
      transition(['z1'], ['z1'], [], []),
    );
    await Promise.resolve();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('emits "exit" once with the position observed outside the zone', async () => {
    const z1 = zone('z1');
    renderHook(() => useGeofenceWithEvents([z1], OPTS));
    capturedOnZonesChanged!(
      [z1],
      ENTER_POSITION,
      transition([], ['z1'], [z1], []),
    );
    await Promise.resolve();
    emitMock.mockClear();

    capturedOnZonesChanged!(
      [],
      EXIT_POSITION,
      transition(['z1'], [], [], [z1]),
    );
    await Promise.resolve();

    expect(emitMock).toHaveBeenCalledTimes(1);
    const ev = emitMock.mock.calls[0]![0] as { type: string; payload: Record<string, unknown> };
    expect(ev.type).toBe('geofence_crossed');
    expect(ev.payload).toMatchObject({
      zoneId: 'z1',
      direction: 'exit',
      lat: EXIT_POSITION.lat,
      lng: EXIT_POSITION.lng,
    });
  });

  it('emits both sides of a direct crossing from one transition', async () => {
    const z1 = zone('z1');
    const z2 = zone('z2');
    renderHook(() => useGeofenceWithEvents([z1, z2], OPTS));

    capturedOnZonesChanged!(
      [z2],
      ENTER_POSITION,
      transition(['z1'], ['z2'], [z2], [z1]),
    );
    await Promise.resolve();

    expect(emitMock).toHaveBeenCalledTimes(2);
    const payloads = emitMock.mock.calls.map(
      ([event]) => (event as { payload: Record<string, unknown> }).payload,
    );
    expect(payloads).toEqual([
      expect.objectContaining({ zoneId: 'z2', direction: 'enter' }),
      expect.objectContaining({ zoneId: 'z1', direction: 'exit' }),
    ]);
  });

  it('emits an exit using retained metadata after a zone is removed', async () => {
    const removedZone = zone('removed');
    renderHook(() => useGeofenceWithEvents([], OPTS));

    capturedOnZonesChanged!(
      [],
      EXIT_POSITION,
      transition(['removed'], [], [], [removedZone]),
    );
    await Promise.resolve();

    expect(emitMock).toHaveBeenCalledTimes(1);
    const event = emitMock.mock.calls[0]![0] as {
      payload: Record<string, unknown>;
    };
    expect(event.payload).toMatchObject({
      zoneId: 'removed',
      zoneName: 'Zona removed',
      direction: 'exit',
    });
  });

  it('omits coordinates when an injected caller has no location fix', async () => {
    const z1 = zone('z1');
    renderHook(() => useGeofenceWithEvents([z1], OPTS));

    capturedOnZonesChanged!(
      [z1],
      undefined,
      transition([], ['z1'], [z1], []),
    );
    await Promise.resolve();

    const ev = emitMock.mock.calls[0]![0] as { payload: Record<string, unknown> };
    expect(ev.payload).not.toHaveProperty('lat');
    expect(ev.payload).not.toHaveProperty('lng');
  });
});
