// @vitest-environment jsdom
//
// Tests for the Man Down (Hombre Caído) detection hook — VITAL safety code.
//
// The external strategic report (2026-05) flagged smartphone fall-detection
// false-positives as the key risk. This hook's mitigations ARE the answer and
// must stay verified:
//   - jerk-based movement detection (orientation-invariant) instead of the
//     naive |acc-9.8| heuristic, so a worker resting at an angle isn't flagged;
//   - a 10s cancellation countdown before any alert fires (worker can self-cancel);
//   - a sustained alarm loop (≥30s) for unconscious-worker discoverability;
//   - explicit supervisor acknowledgement to silence the alarm.
//
// We drive the inactivity→countdown→alert→acknowledge state machine with async
// fake timers and assert the Firestore/black-box side effects happen in order.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  state: {
    acceleration: { x: null as number | null, y: null as number | null, z: null as number | null },
    project: { id: 'p1', name: 'Mina X', settings: {} } as
      | { id: string; name: string; settings: Record<string, unknown> }
      | null,
    user: { uid: 'u1', displayName: 'Juan Pérez' } as
      | { uid: string; displayName: string | null }
      | null,
  },
  startListening: vi.fn(),
  stopListening: vi.fn(),
  addNode: vi.fn(),
  addDoc: vi.fn(),
  collection: vi.fn(() => ({})),
  serverTimestamp: vi.fn(() => 'TS'),
  updateDoc: vi.fn(),
  doc: vi.fn(() => ({})),
  saveBlackBox: vi.fn(),
  tagIncidentTipo: vi.fn((base: unknown) => base),
  getActiveSession: vi.fn(() => null),
  triggerEmergency: vi.fn(),
}));

vi.mock('../contexts/SensorContext', () => ({
  useSensors: () => ({
    sensorData: { acceleration: h.state.acceleration },
    startListening: h.startListening,
    stopListening: h.stopListening,
  }),
}));
vi.mock('./useRiskEngine', () => ({ useRiskEngine: () => ({ addNode: h.addNode }) }));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: h.state.project }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: h.state.user }),
}));
vi.mock('../contexts/EmergencyContext', () => ({
  useEmergency: () => ({ triggerEmergency: h.triggerEmergency }),
}));
vi.mock('../services/firebase', () => ({
  db: {},
  collection: h.collection,
  addDoc: h.addDoc,
  serverTimestamp: h.serverTimestamp,
}));
vi.mock('firebase/firestore', () => ({ doc: h.doc, updateDoc: h.updateDoc }));
vi.mock('../utils/offlineStorage', () => ({ saveBlackBox: h.saveBlackBox }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/driving/commuteSession', () => ({
  tagIncidentTipo: h.tagIncidentTipo,
  getActiveSession: h.getActiveSession,
}));

import { useManDownDetection } from './useManDownDetection';

// Advance fake time one second at a time, flushing React between ticks. This
// mimics real-world timing (React commits state + re-runs effects between the
// hook's 1s intervals) and avoids the bulk-advance artifact where the
// inactivity timer's stale `isAlerting` closure stacks many countdowns.
async function tickSeconds(n: number) {
  for (let i = 0; i < n; i++) {

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Reset shared state to defaults each test.
  h.state.acceleration = { x: null, y: null, z: null };
  h.state.project = { id: 'p1', name: 'Mina X', settings: {} };
  h.state.user = { uid: 'u1', displayName: 'Juan Pérez' };
  h.addNode.mockResolvedValue(undefined);
  h.addDoc.mockResolvedValue({ id: 'evt1' });
  h.updateDoc.mockResolvedValue(undefined);
  h.saveBlackBox.mockResolvedValue(undefined);
  h.triggerEmergency.mockResolvedValue(undefined);
  h.tagIncidentTipo.mockImplementation((base: unknown) => base);
  h.getActiveSession.mockReturnValue(null);
  // jsdom has no geolocation — provide a deterministic success so triggerAlert
  // exercises the GPS-success branch.
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: -33.45, longitude: -70.66 } } as GeolocationPosition),
    },
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('useManDownDetection — lifecycle', () => {
  it('starts inactive with a 10s countdown default', () => {
    const { result } = renderHook(() => useManDownDetection());
    expect(result.current.isActive).toBe(false);
    expect(result.current.isAlerting).toBe(false);
    expect(result.current.countdown).toBe(10);
  });

  it('startDetection activates + begins sensor listening', () => {
    const { result } = renderHook(() => useManDownDetection());
    act(() => result.current.startDetection());
    expect(result.current.isActive).toBe(true);
    expect(h.startListening).toHaveBeenCalledTimes(1);
  });

  it('stopDetection deactivates + stops sensor listening', () => {
    const { result } = renderHook(() => useManDownDetection());
    act(() => result.current.startDetection());
    act(() => result.current.stopDetection());
    expect(result.current.isActive).toBe(false);
    expect(result.current.isAlerting).toBe(false);
    expect(h.stopListening).toHaveBeenCalledTimes(1);
  });

  it('cancelCountdown resets alerting state to the 10s default', () => {
    const { result } = renderHook(() => useManDownDetection());
    act(() => result.current.startDetection());
    act(() => result.current.cancelCountdown());
    expect(result.current.isAlerting).toBe(false);
    expect(result.current.countdown).toBe(10);
  });
});

describe('useManDownDetection — inactivity escalation', () => {
  it('raises the alert after the inactivity threshold with no movement', async () => {
    const { result } = renderHook(() => useManDownDetection());
    act(() => result.current.startDetection());
    // No movement (acceleration null). Default threshold is 30s.
    await tickSeconds(31);
    expect(result.current.isAlerting).toBe(true);
  });

  it('fires the full alert (FCM dispatch + risk node + crisis msg + mandown_event + black box) when the countdown elapses', async () => {
    const onManDownConfirmed = vi.fn();
    const { result } = renderHook(() => useManDownDetection({ onManDownConfirmed }));
    act(() => result.current.startDetection());
    // 30s inactivity + 10s countdown → alert fires.
    await tickSeconds(42);
    expect(h.saveBlackBox).toHaveBeenCalledTimes(1);
    // Life-safety GAP fix (B1): the emergency pipeline is dispatched → FCM push
    // wakes the supervisor even with the downed worker's phone backgrounded.
    expect(h.triggerEmergency).toHaveBeenCalledWith('man_down', 'p1');
    expect(h.addNode).toHaveBeenCalledTimes(1);
    // addDoc is called for emergency_messages AND mandown_events.
    expect(h.addDoc).toHaveBeenCalledTimes(2);
    expect(onManDownConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', userName: 'Juan Pérez' }),
    );
  });

  it('does NOT escalate before the inactivity threshold', async () => {
    const { result } = renderHook(() => useManDownDetection());
    act(() => result.current.startDetection());
    await tickSeconds(20);
    expect(result.current.isAlerting).toBe(false);
    expect(h.addNode).not.toHaveBeenCalled();
  });
});

describe('useManDownDetection — acknowledge', () => {
  it('acknowledgeAlert marks the mandown_event acknowledged + silences alerting', async () => {
    const { result } = renderHook(() => useManDownDetection());
    act(() => result.current.startDetection());
    await tickSeconds(42);
    // Event doc was created → acknowledgeAlert should update it.
    await act(async () => {
      await result.current.acknowledgeAlert();
    });
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    const payload = h.updateDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.status).toBe('acknowledged');
    expect(payload.acknowledgedBy).toBe('u1');
    expect(result.current.isAlerting).toBe(false);
  });

  it('acknowledgeAlert with no active event is a safe no-op', async () => {
    const { result } = renderHook(() => useManDownDetection());
    await act(async () => {
      await result.current.acknowledgeAlert();
    });
    expect(h.updateDoc).not.toHaveBeenCalled();
  });
});

describe('useManDownDetection — guards', () => {
  it('countdown still completes but skips Firestore writes when no project/user', async () => {
    h.state.project = null;
    h.state.user = null;
    const { result } = renderHook(() => useManDownDetection());
    act(() => result.current.startDetection());
    await tickSeconds(42);
    // triggerAlert early-returns after starting the local alarm → no network
    // writes and no emergency dispatch (the guard precedes both).
    expect(h.addNode).not.toHaveBeenCalled();
    expect(h.addDoc).not.toHaveBeenCalled();
    expect(h.saveBlackBox).not.toHaveBeenCalled();
    expect(h.triggerEmergency).not.toHaveBeenCalled();
  });
});
