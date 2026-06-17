// @vitest-environment jsdom
//
// VIDA: the survival heartbeat must keep saving a LOCAL GPS breadcrumb even
// when OFFLINE (tunnel/pit) — that on-device trail is exactly what rescuers
// replay. Before the fix the whole effect early-returned when offline, so the
// breadcrumb trail went blank during the outage, when it matters most. We now
// gate only the Firestore write on connectivity; the local breadcrumb is saved
// on every fix.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  online: true,
  user: { uid: 'u1' } as { uid: string } | null,
}));

const saveBreadcrumb = vi.fn(async () => {});
vi.mock('../utils/offlineStorage', () => ({
  saveBreadcrumb: (...a: unknown[]) => saveBreadcrumb(...a),
}));

const setDoc = vi.fn(async () => {});
vi.mock('firebase/firestore', () => ({
  doc: (...a: unknown[]) => ({ __ref: a }),
  setDoc: (...a: unknown[]) => setDoc(...a),
  serverTimestamp: () => 'ts',
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('./useOnlineStatus', () => ({ useOnlineStatus: () => h.online }));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: h.user }),
}));

import { useSurvivalPing } from './useSurvivalPing';

function stubGeolocation(
  coords = { latitude: -33.45, longitude: -70.66 },
) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (
        success: (p: { coords: { latitude: number; longitude: number } }) => void,
      ) => success({ coords }),
    },
  });
}

beforeEach(() => {
  h.online = true;
  h.user = { uid: 'u1' };
  saveBreadcrumb.mockClear();
  setDoc.mockClear();
  vi.useFakeTimers();
  // Start the clock well past the 60s ping gate so the first 10s interval tick
  // (lastPingRef starts at 0) crosses the threshold and triggers a fix.
  vi.setSystemTime(100_000);
  stubGeolocation();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useSurvivalPing — offline breadcrumb (VIDA)', () => {
  it('OFFLINE: saves the local breadcrumb but skips the Firestore write', () => {
    h.online = false;
    renderHook(() => useSurvivalPing());
    vi.advanceTimersByTime(10_000); // first interval tick → geolocation fix
    expect(saveBreadcrumb).toHaveBeenCalledWith('u1', -33.45, -70.66);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('ONLINE: saves the local breadcrumb AND writes the ping doc', () => {
    h.online = true;
    renderHook(() => useSurvivalPing());
    vi.advanceTimersByTime(10_000);
    expect(saveBreadcrumb).toHaveBeenCalledWith('u1', -33.45, -70.66);
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('no user → the heartbeat never starts', () => {
    h.user = null;
    renderHook(() => useSurvivalPing());
    vi.advanceTimersByTime(30_000);
    expect(saveBreadcrumb).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });
});
