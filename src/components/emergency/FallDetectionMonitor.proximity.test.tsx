// @vitest-environment jsdom
/**
 * FallDetectionMonitor × useProximityMode — declared-consumer wiring tests
 * (Phase 5 D1 islands: proximityModeDetector orphan → real).
 *
 * The engine's header (Sprint 49 C.3) declares its purpose: "inPocket →
 * aumentar sensibilidad detección impactos". This suite locks in that
 * FallDetectionMonitor is that consumer:
 *
 *   1. Default carry mode ('normal') → the historical threshold (25 m/s²)
 *      reaches useAccelerometer unchanged. NO behavior change without
 *      proximity evidence.
 *   2. Proximity 'near' + walking accel pattern → 'in_pocket' →
 *      threshold scaled DOWN by policyForMode().fallDetectionMultiplier
 *      (1.3x more sensitive), and the mode transition reaches the sensorBus
 *      ('device_mode' reading).
 *   3. A detected impact publishes the current carry mode in the fall
 *      reading's meta (black-box context for the correlation engine).
 *
 * Real code under test: FallDetectionMonitor + useProximityMode +
 * proximityModeDetector engine + the singleton sensorBus. Only hardware
 * boundaries are faked: useAccelerometer (stateful mock feeding `data`) and
 * the proximity plugin loader (contract-shaped fake).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import type { ProximityPluginContract } from '../../services/proximitySensor/proximityModeDetector';

// ── Hardware fakes ──────────────────────────────────────────────────────

type ProximityCb = (e: { state: 'near' | 'far'; timestamp: number }) => void;

const fake = vi.hoisted(() => {
  const listeners: Array<(e: { state: 'near' | 'far'; timestamp: number }) => void> = [];
  return {
    listeners,
    emit(state: 'near' | 'far') {
      for (const cb of [...listeners]) cb({ state, timestamp: Date.now() });
    },
  };
});

const fakePlugin: ProximityPluginContract = {
  addListener(_event: 'proximityChanged', cb: ProximityCb) {
    fake.listeners.push(cb);
    return {
      remove: async () => {
        const i = fake.listeners.indexOf(cb);
        if (i >= 0) fake.listeners.splice(i, 1);
      },
    };
  },
  getCurrent: async () => ({ state: 'far' as const }),
};

// In production the hook falls back to the adapter (which returns null until
// the native event bridge ships) — here we simulate a bridged device.
vi.mock('../../services/proximitySensor/proximityPluginAdapter', () => ({
  loadProximityPlugin: async () => fakePlugin,
}));

// Stateful accelerometer mock: captures the threshold option the component
// passes (the assertion target) and lets tests drive the `data` stream the
// component forwards into useProximityMode.pushAccelSample.
interface AccelData { x: number; y: number; z: number; acceleration: number }
let capturedThreshold: number | null = null;
let setMockAccelData: ((d: AccelData | null) => void) | null = null;
let capturedOnFallDetected: (() => void) | null = null;

vi.mock('../../hooks/useAccelerometer', () => ({
  useAccelerometer: (opts: { threshold?: number; onFallDetected?: () => void }) => {
    capturedThreshold = opts.threshold ?? null;
    capturedOnFallDetected = opts.onFallDetected ?? null;
    const [data, setData] = React.useState<AccelData | null>(null);
    setMockAccelData = setData;
    return {
      data,
      isSupported: true,
      isActive: true,
      permissionGranted: true,
      start: vi.fn(),
      stop: vi.fn(),
      requestPermission: vi.fn(async () => true),
    };
  },
}));

// ── Context mocks (same shape as FallDetectionMonitor.test.tsx) ─────────

vi.mock('../../contexts/EmergencyContext', () => ({
  useEmergency: () => ({
    isEmergencyActive: false,
    emergencyType: null,
    triggerEmergency: vi.fn(async () => undefined),
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
vi.mock('../../services/analytics', () => ({
  analytics: { track: vi.fn(async () => undefined) },
}));
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
import { useSensorBus } from '../../services/sensorBus/sensorBus';

const G = 9.81;

/** Feed one DeviceMotion-shaped sample (m/s², x-dominant) into the component. */
function feedSample(magG: number) {
  act(() => {
    setMockAccelData?.({ x: magG * G, y: 0, z: 0, acceleration: magG * G });
  });
}

beforeEach(() => {
  capturedThreshold = null;
  capturedOnFallDetected = null;
  setMockAccelData = null;
  fake.listeners.length = 0;
  useSensorBus.getState().reset();
});

afterEach(() => {
  cleanup();
});

describe('FallDetectionMonitor — proximity carry-mode consumer (D1 wiring)', () => {
  it('passes the unscaled 25 m/s² threshold while the carry mode is normal', async () => {
    render(<FallDetectionMonitor />);
    await waitFor(() => expect(fake.listeners.length).toBe(1));
    expect(capturedThreshold).toBe(25);
  });

  it('in_pocket mode scales the impact threshold by 1/1.3 (declared purpose: more sensitive in pocket)', async () => {
    render(<FallDetectionMonitor />);
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      fake.emit('near');
    });
    // Walking-in-pocket pattern: avg ≈1.1G, latest sample not quiet.
    feedSample(1.0);
    feedSample(1.3);
    feedSample(0.9);
    feedSample(1.2);

    await waitFor(() => expect(capturedThreshold).toBeCloseTo(25 / 1.3, 2));

    // The transition also reached the central bus (established §16.2.1 pattern).
    const r = useSensorBus.getState().readings.get('user_test_001::device_mode');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('info');
    expect(r?.meta).toMatchObject({ mode: 'in_pocket' });
  });

  it('publishes the current carry mode inside the fall reading meta', async () => {
    render(<FallDetectionMonitor />);
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      fake.emit('near');
    });
    feedSample(1.0);
    feedSample(1.3);
    feedSample(0.9);
    feedSample(1.2);
    await waitFor(() => expect(capturedThreshold).toBeCloseTo(25 / 1.3, 2));

    act(() => {
      capturedOnFallDetected?.();
    });

    const fall = useSensorBus.getState().readings.get('user_test_001::fall');
    expect(fall).toBeDefined();
    expect(fall?.meta).toMatchObject({ deviceMode: 'in_pocket' });
  });

  it('returning to far restores the unscaled threshold', async () => {
    render(<FallDetectionMonitor />);
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      fake.emit('near');
    });
    feedSample(1.0);
    feedSample(1.3);
    feedSample(0.9);
    feedSample(1.2);
    await waitFor(() => expect(capturedThreshold).toBeCloseTo(25 / 1.3, 2));

    act(() => {
      fake.emit('far');
    });
    await waitFor(() => expect(capturedThreshold).toBe(25));
  });
});
