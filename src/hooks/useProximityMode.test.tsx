// @vitest-environment jsdom
//
// useProximityMode — proximityModeDetector → sensorBus wiring tests
// (Phase 5 D1 islands: orphan engine made real).
//
// The pure engine (`src/services/proximitySensor/proximityModeDetector.ts`)
// was shipped in Sprint 49 C.3 but never wired: zero production importers.
// This bridge hook is the impure caller the engine's header demands — it
// receives proximity readings (native plugin via DI contract) + accelerometer
// samples (pushed by the host component, NO second hardware listener), runs
// the REAL `classifyMode`/`policyForMode`, and publishes mode transitions to
// the central sensorBus following the §16.2.1 publisher pattern.
//
// TDD note: these tests exercise the real engine + the real singleton bus.
// Only the hardware boundary (plugin contract) is faked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useProximityMode } from './useProximityMode';
import { useSensorBus } from '../services/sensorBus/sensorBus';
import type { ProximityPluginContract } from '../services/proximitySensor/proximityModeDetector';

const G = 9.81; // m/s² per 1G — the hook converts DeviceMotion m/s² → G.

type ProximityCb = (e: { state: 'near' | 'far'; timestamp: number }) => void;

/** Minimal fake implementing the engine's own DI contract. */
function makeFakePlugin(initial: 'near' | 'far' = 'far') {
  const listeners: ProximityCb[] = [];
  const removed: number[] = [];
  const enabled: number[] = [];
  const disabled: number[] = [];
  return {
    listeners,
    removed,
    enabled,
    disabled,
    emit(state: 'near' | 'far') {
      for (const cb of listeners) cb({ state, timestamp: Date.now() });
    },
    plugin: {
      async enable() {
        enabled.push(enabled.length);
      },
      async disable() {
        disabled.push(disabled.length);
      },
      async addListener(_event: 'proximityChanged', cb: ProximityCb) {
        listeners.push(cb);
        const idx = listeners.length - 1;
        return {
          remove: async () => {
            removed.push(idx);
            listeners.splice(listeners.indexOf(cb), 1);
          },
        };
      },
      getCurrent: async () => ({ state: initial }),
    } as unknown as ProximityPluginContract,
  };
}

/** m/s² sample helper. `magG` is the desired vector magnitude in G. */
function sampleMs2(magG: number, axes: { x?: number; y?: number; z?: number } = {}) {
  return {
    x: (axes.x ?? 0) * G,
    y: (axes.y ?? 0) * G,
    z: (axes.z ?? 0) * G,
    acceleration: magG * G,
  };
}

beforeEach(() => {
  useSensorBus.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useProximityMode — engine wiring', () => {
  it('starts in normal mode with the neutral policy when no plugin is available', () => {
    const { result } = renderHook(() =>
      useProximityMode({ plugin: null, workerUid: 'w1', projectId: 'p1' }),
    );

    expect(result.current.modeState.currentMode).toBe('normal');
    expect(result.current.policy.fallDetectionMultiplier).toBe(1.0);
    expect(result.current.policy.suppressAccidentalTaps).toBe(false);
    // No transition happened → nothing on the bus.
    expect(useSensorBus.getState().readings.get('w1::device_mode')).toBeUndefined();
  });

  it('proximity near + face-down accel → face_down mode, warning published to the bus', async () => {
    const fake = makeFakePlugin();
    const { result } = renderHook(() =>
      useProximityMode({ plugin: fake.plugin, workerUid: 'w1', projectId: 'p1' }),
    );
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      result.current.pushAccelSample(sampleMs2(1.0, { y: -0.95 }));
      fake.emit('near');
    });

    expect(result.current.modeState.currentMode).toBe('face_down');
    expect(result.current.policy.promptManualCheckin).toBe(true);
    expect(result.current.policy.fallDetectionMultiplier).toBe(2.0);

    const r = useSensorBus.getState().readings.get('w1::device_mode');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('warning');
    expect(r?.projectId).toBe('p1');
    expect(r?.meta).toMatchObject({ mode: 'face_down', source: 'useProximityMode' });
  });

  it('proximity near + walking pattern → in_pocket mode (info severity, taps suppressed)', async () => {
    const fake = makeFakePlugin();
    const { result } = renderHook(() =>
      useProximityMode({ plugin: fake.plugin, workerUid: 'w1', projectId: 'p1' }),
    );
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      fake.emit('near');
      // Walking-in-pocket: avg ≈1.1G, latest sample NOT quiet (1.2G) and
      // x-dominant so neither face_down (y) nor helmet (quiet+tilt) match.
      result.current.pushAccelSample(sampleMs2(1.0, { x: 1.0 }));
      result.current.pushAccelSample(sampleMs2(1.3, { x: 1.3 }));
      result.current.pushAccelSample(sampleMs2(0.9, { x: 0.9 }));
      result.current.pushAccelSample(sampleMs2(1.2, { x: 1.2 }));
    });

    expect(result.current.modeState.currentMode).toBe('in_pocket');
    expect(result.current.policy.suppressAccidentalTaps).toBe(true);
    expect(result.current.policy.fallDetectionMultiplier).toBe(1.3);

    const r = useSensorBus.getState().readings.get('w1::device_mode');
    expect(r?.severity).toBe('info');
    expect(r?.meta).toMatchObject({ mode: 'in_pocket' });
  });

  it('proximity near + quiet 45-60° tilt → in_helmet_mount (hands-free policy)', async () => {
    const fake = makeFakePlugin();
    const { result } = renderHook(() =>
      useProximityMode({ plugin: fake.plugin, workerUid: 'w1', projectId: 'p1' }),
    );
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      result.current.pushAccelSample(sampleMs2(1.0, { x: 0.5, y: 0.5, z: 0.7 }));
      fake.emit('near');
    });

    expect(result.current.modeState.currentMode).toBe('in_helmet_mount');
    expect(result.current.policy.enableVoiceMode).toBe(true);
    expect(result.current.policy.acceleratedHeartbeat).toBe(true);
  });

  it('returning to far publishes the normal transition (clears prior warning on the bus)', async () => {
    const fake = makeFakePlugin();
    const { result } = renderHook(() =>
      useProximityMode({ plugin: fake.plugin, workerUid: 'w1', projectId: 'p1' }),
    );
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      result.current.pushAccelSample(sampleMs2(1.0, { y: -0.95 }));
      fake.emit('near');
    });
    expect(useSensorBus.getState().readings.get('w1::device_mode')?.severity).toBe('warning');

    act(() => {
      fake.emit('far');
    });

    expect(result.current.modeState.currentMode).toBe('normal');
    const r = useSensorBus.getState().readings.get('w1::device_mode');
    expect(r?.severity).toBe('info');
    expect(r?.meta).toMatchObject({ mode: 'normal' });
  });

  it('does NOT republish to the bus while the mode is unchanged (transition-only publishing)', async () => {
    const fake = makeFakePlugin();
    const { result } = renderHook(() =>
      useProximityMode({ plugin: fake.plugin, workerUid: 'w1', projectId: 'p1' }),
    );
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      result.current.pushAccelSample(sampleMs2(1.0, { y: -0.95 }));
      fake.emit('near');
    });
    const first = useSensorBus.getState().readings.get('w1::device_mode');
    expect(first?.meta).toMatchObject({ mode: 'face_down' });

    act(() => {
      // Same face-down evidence again → same mode → no new bus reading.
      result.current.pushAccelSample(sampleMs2(1.0, { y: -0.95 }));
    });
    const second = useSensorBus.getState().readings.get('w1::device_mode');
    expect(second?.readingId).toBe(first?.readingId);
    // Stickiness: enteredAt is preserved across re-classification.
    expect(result.current.modeState.currentMode).toBe('face_down');
  });

  it('seeds the initial proximity state from plugin.getCurrent()', async () => {
    const fake = makeFakePlugin('near');
    const { result } = renderHook(() =>
      useProximityMode({ plugin: fake.plugin, workerUid: 'w1', projectId: 'p1' }),
    );

    // getCurrent() resolved 'near' with an empty accel window → near_head fallback.
    await waitFor(() => expect(result.current.modeState.currentMode).toBe('near_head'));
    expect(result.current.policy.suppressAccidentalTaps).toBe(true);
  });

  it('enables native monitoring before consuming readings', async () => {
    const fake = makeFakePlugin();
    renderHook(() => useProximityMode({ plugin: fake.plugin }));

    await waitFor(() => expect(fake.listeners.length).toBe(1));
    expect(fake.enabled).toHaveLength(1);
  });

  it('ignores malformed native states instead of creating life-safety evidence', async () => {
    const fake = makeFakePlugin();
    const { result } = renderHook(() => useProximityMode({ plugin: fake.plugin }));
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    act(() => {
      result.current.pushAccelSample(sampleMs2(1.0, { y: -0.95 }));
      const callback = fake.listeners[0] as unknown as (event: unknown) => void;
      callback({ state: 'covered-ish', timestamp: Date.now() });
    });

    expect(result.current.modeState.currentMode).toBe('normal');
  });

  it('removes a listener that resolves after unmount and disables only once', async () => {
    let resolveListener:
      | ((handle: { remove(): Promise<void> }) => void)
      | undefined;
    const remove = vi.fn(async () => undefined);
    const enable = vi.fn(async () => undefined);
    const disable = vi.fn(async () => undefined);
    const delayedPlugin = {
      enable,
      disable,
      addListener: vi.fn(
        async () =>
          new Promise<{ remove(): Promise<void> }>((resolve) => {
            resolveListener = resolve;
          }),
      ),
      getCurrent: vi.fn(async () => ({ state: 'far' as const })),
    } as unknown as ProximityPluginContract;

    const { unmount } = renderHook(() =>
      useProximityMode({ plugin: delayedPlugin }),
    );
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));

    unmount();
    resolveListener?.({ remove });

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it('removes the plugin listener on unmount', async () => {
    const fake = makeFakePlugin();
    const { unmount } = renderHook(() =>
      useProximityMode({ plugin: fake.plugin, workerUid: 'w1', projectId: 'p1' }),
    );
    await waitFor(() => expect(fake.listeners.length).toBe(1));

    unmount();
    await waitFor(() => expect(fake.listeners.length).toBe(0));
    await waitFor(() => expect(fake.disabled).toHaveLength(1));
  });

  it('disabled → ignores plugin events and stays normal', async () => {
    const fake = makeFakePlugin();
    const { result } = renderHook(() =>
      useProximityMode({ plugin: fake.plugin, workerUid: 'w1', projectId: 'p1', enabled: false }),
    );

    // Listener is never attached while disabled.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fake.listeners.length).toBe(0);
    expect(result.current.modeState.currentMode).toBe('normal');
  });
});
