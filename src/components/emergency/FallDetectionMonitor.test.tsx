// @vitest-environment jsdom
/**
 * Sprint 27 P0 audit — hallazgo H6 regression test.
 *
 * Before this fix the countdown-expiry branch and the "Necesito Ayuda"
 * branch only emitted a local toast (`addNotification`); the canonical
 * `EmergencyContext.triggerEmergency('fall', …)` dispatcher was a TODO
 * comment. This suite locks in the wired behavior:
 *
 *   1. Countdown expires (15s default) → `triggerEmergency('fall', …)`
 *      called exactly once.
 *   2. "Estoy Bien" cancels → `triggerEmergency` is NEVER called.
 *   3. "Necesito Ayuda" → `triggerEmergency('fall', …)` called once
 *      immediately (no countdown wait).
 *
 * The component reaches the modal via the accelerometer's `onFallDetected`
 * callback. Rather than spin up a real DeviceMotion event stream we mock
 * `useAccelerometer` to capture and synchronously invoke the callback
 * supplied by the component — that's the same effective code path.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

// ── Mocks (declared before the import-under-test so vi.mock hoists correctly).

const triggerEmergencyMock = vi.fn(async () => undefined);

vi.mock('../../contexts/EmergencyContext', () => ({
  useEmergency: () => ({
    isEmergencyActive: false,
    emergencyType: null,
    triggerEmergency: triggerEmergencyMock,
    resolveEmergency: vi.fn(),
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: { id: 'proj_test_001', name: 'Test Project' },
    projects: [],
    setSelectedProject: vi.fn(),
    createProject: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    addNotification: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({
    user: { uid: 'user_test_001', displayName: 'Test User' },
  }),
}));

vi.mock('../../hooks/useFallDetectionPreference', () => ({
  useFallDetectionPreference: () => ({ enabled: true, loading: false }),
}));

// `useAccelerometer` is the bridge between the hardware sensor and the
// component. We capture the `onFallDetected` callback the component passes
// in and expose a helper to invoke it on demand — that simulates a real
// fall impact crossing the threshold.
let capturedOnFallDetected: (() => void) | null = null;
vi.mock('../../hooks/useAccelerometer', () => ({
  useAccelerometer: (opts: { onFallDetected?: () => void }) => {
    capturedOnFallDetected = opts.onFallDetected ?? null;
    return {
      data: null,
      isSupported: true,
      isActive: false,
      permissionGranted: true,
      start: vi.fn(),
      stop: vi.fn(),
      requestPermission: vi.fn(async () => true),
    };
  },
}));

// Analytics must never throw. Stub to a no-op so the production try/catch
// in `handleFallDetected` is exercised cleanly.
vi.mock('../../services/analytics', () => ({
  analytics: { track: vi.fn(async () => undefined) },
}));

// framer-motion's AnimatePresence does an exit animation cycle that
// confuses fake timers. Replace it with passthrough wrappers — we only
// care about whether the modal mounts and which buttons are clicked.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: any) =>
          React.createElement('div', rest, children),
    },
  ),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

import { FallDetectionMonitor } from './FallDetectionMonitor';

function triggerFall() {
  // Production accelerometer would call this on impact; we drive it manually.
  if (!capturedOnFallDetected) throw new Error('useAccelerometer mock did not capture onFallDetected');
  act(() => {
    capturedOnFallDetected!();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  triggerEmergencyMock.mockClear();
  capturedOnFallDetected = null;
});

afterEach(() => {
  // testing-library's auto-cleanup only fires when its globals are
  // injected (via setupFiles); our setup is conditional, so we call
  // cleanup() explicitly to unmount between tests. Without this, every
  // describe() block's modal accumulates in document.body and `getByRole`
  // sees N copies of "Estoy Bien" / "Necesito Ayuda".
  cleanup();
  vi.useRealTimers();
});

describe('FallDetectionMonitor — H6 SOS dispatcher wire-up', () => {
  it('calls triggerEmergency("fall", projectId) exactly once when the countdown expires', async () => {
    render(<FallDetectionMonitor />);
    triggerFall();

    // Modal mounts — sanity check.
    expect(screen.getByText(/¿Estás bien\?/i)).toBeInTheDocument();
    expect(triggerEmergencyMock).not.toHaveBeenCalled();

    // Countdown is 15s. The countdown useEffect schedules one setTimeout
    // per second; each fired timeout calls `setCountdown(c => c - 1)`,
    // which re-runs the effect on the next render and arms the next
    // setTimeout. We must let React flush its state update between ticks,
    // so we wrap each 1s advance in its own `act()` call.
    for (let i = 0; i < 16; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }

    // dispatchFallEmergency wraps the call in `Promise.resolve().then(...)`
    // (so a synchronous failure inside triggerEmergency cannot break the
    // modal-close path). Fake timers don't drain microtasks — flush them
    // with a real-timers tick before asserting.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(triggerEmergencyMock).toHaveBeenCalledTimes(1);
    expect(triggerEmergencyMock).toHaveBeenCalledWith('fall', 'proj_test_001');
  });

  it('does NOT dispatch when the user taps "Estoy Bien"', () => {
    render(<FallDetectionMonitor />);
    triggerFall();

    const okBtn = screen.getByRole('button', { name: /Estoy Bien/i });
    act(() => {
      fireEvent.click(okBtn);
    });

    // Even after letting >15s of timers elapse, no dispatch should have happened.
    for (let i = 0; i < 20; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }

    expect(triggerEmergencyMock).not.toHaveBeenCalled();
  });

  it('dispatches immediately when the user taps "Necesito Ayuda" (no countdown wait)', () => {
    render(<FallDetectionMonitor />);
    triggerFall();

    expect(triggerEmergencyMock).not.toHaveBeenCalled();

    const helpBtn = screen.getByRole('button', { name: /Necesito Ayuda/i });
    act(() => {
      fireEvent.click(helpBtn);
    });

    // Flush the micro-task chain inside `dispatchFallEmergency`
    // (Promise.resolve().then(triggerEmergency)).
    return Promise.resolve().then(() => {
      expect(triggerEmergencyMock).toHaveBeenCalledTimes(1);
      expect(triggerEmergencyMock).toHaveBeenCalledWith('fall', 'proj_test_001');
    });
  });
});
