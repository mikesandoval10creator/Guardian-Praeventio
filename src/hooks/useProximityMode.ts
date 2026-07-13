// Praeventio Guard — proximityModeDetector → sensorBus bridge hook
// (Phase 5 D1 islands: orphan engine made real).
//
// The pure engine (`src/services/proximitySensor/proximityModeDetector.ts`,
// Sprint 49 C.3) classifies the device carry mode (normal / in_pocket /
// near_head / in_helmet_mount / face_down) from proximity readings +
// accelerometer samples, and `policyForMode` translates the mode into
// life-safety knobs (fall-detection sensitivity multiplier, tap suppression,
// hands-free, check-in prompt). Its header demands an impure caller that
// "wirea el plugin nativo" — this hook is that caller (repo rule #9: the
// engine stays pure, side effects live here).
//
// Wiring model (mirrors the §16.2.1 sensor-hook pattern):
//   - Proximity source: the engine's own `ProximityPluginContract`, resolved
//     via DI (`options.plugin`) or the first-party `loadProximityPlugin()`
//     bridge in packages/capacitor-proximity.
//   - Accelerometer source: the HOST component pushes samples from its
//     EXISTING DeviceMotion stream via `pushAccelSample` — deliberately no
//     second hardware listener (`useAccelerometer.stop()` calls
//     `Motion.removeAllListeners()` on native, which would nuke every motion
//     listener app-wide; fall detection is life-safety).
//   - Output: `{ modeState, policy }` for the host (FallDetectionMonitor
//     scales its impact threshold) + mode TRANSITIONS published to the
//     central sensorBus ('device_mode' kind, face_down → 'warning') so the
//     correlation layer gains carry-mode evidence.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  classifyMode,
  policyForMode,
  type AccelerometerSample,
  type ModeDetectorState,
  type ModePolicy,
  type ProximityPluginContract,
  type ProximityReading,
} from '../services/proximitySensor/proximityModeDetector';
import { loadProximityPlugin } from '../services/proximitySensor/proximityPluginAdapter';
import { publishSensorEvent } from '../services/sensorBus/publishSensorEvent';
import { logger } from '../utils/logger';

/** m/s² per 1G — DeviceMotion reports m/s², the engine consumes G. */
const GRAVITY_MS2 = 9.81;
/** Rolling accel window the engine classifies over (~1-2s at typical rates). */
const ACCEL_WINDOW_SIZE = 8;

/** DeviceMotion-shaped sample in m/s² (what useAccelerometer exposes). */
export interface AccelSampleInput {
  x: number;
  y: number;
  z: number;
  /** Total vector magnitude in m/s². */
  acceleration: number;
}

export interface UseProximityModeOptions {
  /** Worker uid for bus attribution; LOCAL_DEVICE_UID sentinel when absent. */
  workerUid?: string | null;
  projectId?: string | null;
  /**
   * Proximity source DI. `undefined` → resolve via loadProximityPlugin();
   * `null` → explicitly no source (hook stays inert in 'normal' mode).
   */
  plugin?: ProximityPluginContract | null;
  /** Master switch (default true). Disabled → no listeners, 'normal' mode. */
  enabled?: boolean;
}

export interface UseProximityModeResult {
  /** Current engine classification (mode + confidence + audit reasons). */
  modeState: ModeDetectorState;
  /** Policy derived from the current mode (life-safety knobs). */
  policy: ModePolicy;
  /**
   * Feed one accelerometer sample from the host's existing motion stream.
   * Cheap (pure math); safe to call at DeviceMotion rates.
   */
  pushAccelSample: (sample: AccelSampleInput) => void;
}

function initialModeState(): ModeDetectorState {
  return {
    currentMode: 'normal',
    enteredAt: new Date().toISOString(),
    confidence: 0.9,
    reasons: ['initial state — no proximity evidence yet'],
  };
}

export function useProximityMode(
  options: UseProximityModeOptions = {},
): UseProximityModeResult {
  const { enabled = true, plugin } = options;

  const [modeState, setModeState] = useState<ModeDetectorState>(initialModeState);

  // Refs so the classification path stays referentially stable (no listener
  // churn) while always reading fresh values.
  const modeRef = useRef<ModeDetectorState>(modeState);
  const proximityRef = useRef<ProximityReading>({
    state: 'far',
    at: modeState.enteredAt,
  });
  const accelWindowRef = useRef<AccelerometerSample[]>([]);
  const idsRef = useRef({ workerUid: options.workerUid, projectId: options.projectId });
  idsRef.current = { workerUid: options.workerUid, projectId: options.projectId };
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const reclassify = useCallback((now: Date = new Date()) => {
    const previous = modeRef.current;
    const next = classifyMode({
      proximity: proximityRef.current,
      recentAccelerometer: accelWindowRef.current,
      previousMode: previous,
      now,
    });

    if (next.currentMode === previous.currentMode) {
      // Same mode: keep the rendered state (enteredAt already preserved by
      // the engine's stickiness) — avoids re-renders at DeviceMotion rates.
      modeRef.current = next;
      return;
    }

    modeRef.current = next;
    setModeState(next);
    // Transition-only publishing: the bus keeps the LATEST reading per
    // (worker, kind), so each transition supersedes the previous one and a
    // return to 'normal'/'info' clears an earlier face_down warning.
    publishSensorEvent({
      kind: 'device_mode',
      severity: next.currentMode === 'face_down' ? 'warning' : 'info',
      workerUid: idsRef.current.workerUid,
      projectId: idsRef.current.projectId,
      value: next.confidence,
      unit: 'confidence',
      meta: {
        mode: next.currentMode,
        reasons: next.reasons,
        source: 'useProximityMode',
      },
    }, now);
  }, []);

  const pushAccelSample = useCallback(
    (sample: AccelSampleInput) => {
      if (!enabledRef.current) return;
      const converted: AccelerometerSample = {
        x: sample.x / GRAVITY_MS2,
        y: sample.y / GRAVITY_MS2,
        z: sample.z / GRAVITY_MS2,
        magnitudeG: sample.acceleration / GRAVITY_MS2,
        at: new Date().toISOString(),
      };
      const window = accelWindowRef.current;
      window.push(converted);
      if (window.length > ACCEL_WINDOW_SIZE) window.shift();
      reclassify();
    },
    [reclassify],
  );

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let handle: { remove(): Promise<void> } | null = null;
    let activePlugin: ProximityPluginContract | null = null;
    let disableStarted = false;

    const disableOnce = async (source: ProximityPluginContract) => {
      if (disableStarted) return;
      disableStarted = true;
      try {
        await source.disable();
      } catch (err) {
        logger.warn('useProximityMode: plugin disable failed', { err });
      }
    };

    const setup = async () => {
      const resolved = plugin === undefined ? await loadProximityPlugin() : plugin;
      if (!resolved || cancelled) return;

      await resolved.enable();
      activePlugin = resolved;
      if (cancelled) {
        await disableOnce(resolved);
        return;
      }

      const attached = await resolved.addListener('proximityChanged', (e) => {
        if (cancelled) return;
        if (e.state !== 'near' && e.state !== 'far') {
          logger.warn('useProximityMode: ignored malformed proximity state', {
            state: e.state,
          });
          return;
        }
        const at = Number.isFinite(e.timestamp) ? new Date(e.timestamp) : new Date();
        proximityRef.current = { state: e.state, at: at.toISOString() };
        reclassify();
      });
      if (cancelled) {
        await attached.remove().catch(() => undefined);
        await disableOnce(resolved);
        return;
      }
      handle = attached;

      try {
        const current = await resolved.getCurrent();
        if (cancelled) return;
        proximityRef.current = { state: current.state, at: new Date().toISOString() };
        reclassify();
      } catch {
        // Seeding is best-effort; the listener still drives transitions.
      }
    };

    void setup().catch(async (err) => {
      if (activePlugin) {
        await disableOnce(activePlugin);
      }
      // Proximity is an enhancement over life-safety flows — never throw.
      logger.warn('useProximityMode: plugin setup failed', { err });
    });

    return () => {
      cancelled = true;
      const attached = handle;
      const source = activePlugin;
      handle = null;
      activePlugin = null;
      void (async () => {
        if (attached) {
          await attached.remove().catch(() => undefined);
        }
        if (source) {
          await disableOnce(source);
        }
      })();
    };
  }, [enabled, plugin, reclassify]);

  return {
    modeState,
    policy: policyForMode(modeState.currentMode),
    pushAccelSample,
  };
}
