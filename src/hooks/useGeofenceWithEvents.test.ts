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

// Capture the wrapped onZoneEntry callback that useGeofenceWithEvents passes
// into the low-level useGeofence (which we stub — no GPS/watchPosition in tests).
let capturedOnEntry: ((zones: unknown[]) => void) | null = null;
vi.mock('./useGeofence', () => ({
  useGeofence: (_zones: unknown, onEntry: (z: unknown[]) => void) => {
    capturedOnEntry = onEntry;
    return { activeZones: [], permissionState: 'granted' };
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

describe('useGeofenceWithEvents — escalation emit wiring', () => {
  beforeEach(() => {
    capturedOnEntry = null;
    emitMock.mockClear();
  });

  it('emits geofence_crossed "enter" + forwards to onZoneEntry when a zone is entered', async () => {
    const onEntry = vi.fn();
    renderHook(() => useGeofenceWithEvents([zone('z1')], OPTS, onEntry));
    expect(capturedOnEntry).toBeTruthy();

    capturedOnEntry!([zone('z1')]);
    await Promise.resolve();

    expect(emitMock).toHaveBeenCalledTimes(1);
    const ev = emitMock.mock.calls[0]![0] as { type: string; payload: Record<string, unknown> };
    expect(ev.type).toBe('geofence_crossed');
    expect(ev.payload).toMatchObject({ zoneId: 'z1', direction: 'enter', workerId: 'w1', projectId: 'p1' });
    expect(onEntry).toHaveBeenCalledWith([zone('z1')]);
  });

  it('does NOT re-emit "enter" for a zone the worker is still inside', async () => {
    renderHook(() => useGeofenceWithEvents([zone('z1')], OPTS));
    capturedOnEntry!([zone('z1')]);
    await Promise.resolve();
    emitMock.mockClear();

    // Still inside z1 on the next geofence tick → no new emit.
    capturedOnEntry!([zone('z1')]);
    await Promise.resolve();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('emits "exit" once when a previously-inside zone is left', async () => {
    renderHook(() => useGeofenceWithEvents([zone('z1')], OPTS));
    capturedOnEntry!([zone('z1')]); // enter
    await Promise.resolve();
    emitMock.mockClear();

    capturedOnEntry!([]); // left the zone
    await Promise.resolve();

    expect(emitMock).toHaveBeenCalledTimes(1);
    const ev = emitMock.mock.calls[0]![0] as { type: string; payload: Record<string, unknown> };
    expect(ev.type).toBe('geofence_crossed');
    expect(ev.payload).toMatchObject({ zoneId: 'z1', direction: 'exit' });
  });
});
