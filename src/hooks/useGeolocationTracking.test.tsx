// @vitest-environment jsdom
//
// useGeolocationTracking — sensorBus wiring tests (TODO.md §16.2.1).
//
// The tracker already receives positions through its existing watchPosition
// callback; these tests pin that each accepted fix is also published to the
// central sensor bus ('gps' kind) so correlation rules have a last-known
// location signal. No new hardware listeners are added.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  getDocs: vi.fn(),
  addDoc: vi.fn(async () => ({ id: 'loc1' })),
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  serverTimestamp: vi.fn(() => 'TS'),
  isNativePlatform: vi.fn(() => false),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: { id: 'p1', name: 'Mina X' },
  }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u1', email: 'worker@mina.cl' } }),
}));
vi.mock('firebase/firestore', () => ({
  collection: h.collection,
  addDoc: h.addDoc,
  serverTimestamp: h.serverTimestamp,
  query: h.query,
  where: h.where,
  getDocs: h.getDocs,
}));
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: h.isNativePlatform },
}));
vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
  },
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { useGeolocationTracking } from './useGeolocationTracking';
import { useSensorBus } from '../services/sensorBus/sensorBus';

type PositionCb = (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;

let watchCb: PositionCb | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  useSensorBus.getState().reset();
  watchCb = null;
  // Worker has Art. 22 (no fixed schedule) → tracking is always on.
  h.getDocs.mockResolvedValue({
    empty: false,
    docs: [{ data: () => ({ hasArt22: true }) }],
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok: PositionCb) => {
        watchCb = ok;
        return 7;
      }),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGeolocationTracking — sensorBus wiring', () => {
  it("publishes a 'gps' reading to the bus on each accepted position fix", async () => {
    const { unmount } = renderHook(() => useGeolocationTracking());
    await waitFor(() => expect(watchCb).not.toBeNull());

    await act(async () => {
      watchCb!({ coords: { latitude: -33.45678, longitude: -70.66123, accuracy: 12 } });
    });

    const r = useSensorBus.getState().readings.get('u1::gps');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('info');
    expect(r?.projectId).toBe('p1');
    expect(r?.value).toBe(12);
    expect(r?.unit).toBe('m');
    // Rounded to 4 decimals like the Firestore write (≈11 m anonymization).
    expect(r?.meta).toMatchObject({ lat: -33.4568, lng: -70.6612 });

    unmount();
  });

  it('publishes the bus reading even for low-accuracy fixes (Firestore save stays gated at <50 m)', async () => {
    const { unmount } = renderHook(() => useGeolocationTracking());
    await waitFor(() => expect(watchCb).not.toBeNull());

    await act(async () => {
      watchCb!({ coords: { latitude: -33.45, longitude: -70.66, accuracy: 80 } });
    });

    // GPS-alive evidence still reaches the bus…
    expect(useSensorBus.getState().readings.get('u1::gps')?.value).toBe(80);
    // …but the imprecise fix is NOT persisted (pre-existing behavior intact).
    expect(h.addDoc).not.toHaveBeenCalled();

    unmount();
  });
});
