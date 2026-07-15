import React, { useCallback, useEffect, useState } from 'react';
import { useAccelerometer } from '../../hooks/useAccelerometer';
import { useNotifications } from '../../contexts/NotificationContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useFallDetectionPreference } from '../../hooks/useFallDetectionPreference';
import { useEmergency } from '../../contexts/EmergencyContext';
import { useProject } from '../../contexts/ProjectContext';
import { logger } from '../../utils/logger';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, CheckCircle2 } from 'lucide-react';
// 16th wave (Bucket B) analytics: catalog row 67 — fire
// `emergency.fall.detected` the moment the accelerometer heuristic crosses
// the impact threshold (BEFORE the user dismisses the prompt with "Estoy
// Bien" or "Necesito Ayuda"). We track raw detection because the
// post-detection branches are separate dashboard funnels.
import { analytics } from '../../services/analytics';
// §16.2.1 sensorBus wiring: the raw impact is published to the central bus so
// the multi-sensor correlation (fall + inactivity + BLE off → critical) can
// reduce man-down false positives. Reuses this existing detection callback —
// no new hardware listeners.
import { publishSensorEvent } from '../../services/sensorBus/publishSensorEvent';
// Phase 5 D1 wiring — proximityModeDetector's declared consumer. The carry
// mode (in_pocket / in_helmet_mount / face_down / …) scales the impact
// threshold via policyForMode().fallDetectionMultiplier ("inPocket →
// aumentar sensibilidad detección impactos", engine header). The hook reuses
// THIS component's existing accelerometer stream (no second motion listener)
// and publishes mode transitions to the sensorBus ('device_mode' kind).
import { useProximityMode } from '../../hooks/useProximityMode';

/**
 * Threshold the accelerometer heuristic uses (m/s² magnitude). Mirrors the
 * `useAccelerometer({ threshold: 25 })` argument below. Hoisted into the
 * module so the analytics `accel_window_ms` payload can reference the same
 * constant — see catalog row 67.
 */
const FALL_THRESHOLD_MS_SQ = 25;
/** Default polling window for the DeviceMotion event in ms (Capacitor + Web). */
const FALL_ACCEL_WINDOW_MS = 200;

/**
 * H6 audit fix (Sprint 27 P0): when the fall-detection countdown expires
 * OR the user taps "Necesito Ayuda", we must escalate via the canonical
 * `EmergencyContext.triggerEmergency('fall', projectId)` dispatcher — not
 * just a local notification. The dispatcher persists an emergency event in
 * Firestore (`projects/{id}/emergency_events`) AND flips
 * `isEmergencyActive`, which `EmergencyAutoBridge` mirrors into
 * `pushCompanyEmergency` so the global auto-trigger overlay reacts too.
 *
 * `'fall'` is the new canonical type for fall-detection events; existing
 * types (`'sismo'`, `'iot_critical'`, `'driving_sos'`, `'sismo_critico'`,
 * `'fire'`, etc.) remain untouched — `triggerEmergency` accepts any string.
 */
const EMERGENCY_TYPE_FALL = 'fall';

export function FallDetectionMonitor() {
  const { user } = useFirebase();
  const { addNotification } = useNotifications();
  const { enabled: fdEnabled, loading: fdLoading } = useFallDetectionPreference();
  const { triggerEmergency } = useEmergency();
  const { selectedProject } = useProject();
  const [showModal, setShowModal] = useState(false);
  const [countdown, setCountdown] = useState(15);

  // Carry-mode classification (D1). Inert ('normal', multiplier 1.0) until a
  // proximity source exists — see proximityPluginAdapter for the native gap.
  const { modeState, policy, pushAccelSample } = useProximityMode({
    workerUid: user?.uid ?? null,
    projectId: selectedProject?.id ?? null,
    enabled: Boolean(user) && fdEnabled && !fdLoading,
  });

  /**
   * Single dispatch path so the countdown-expiry branch and the
   * "Necesito Ayuda" branch agree on what the canonical SOS escalation
   * looks like. Errors from the dispatcher are logged but never thrown
   * — losing the modal because Firestore is unreachable would be worse
   * than a silent persistence failure (the user already saw the prompt).
   */
  // Memoized so the countdown effect can depend on it without going stale:
  // it closes over `selectedProject`, and a fall SOS dispatched to the wrong
  // faena (a project switched mid-countdown) would page the wrong site's
  // supervisors — the same wrong-faena class as the ProjectContext re-selection
  // bug (#1253). Deps are the exact values it reads.
  const dispatchFallEmergency = useCallback(
    (originLabel: 'countdown_expired' | 'user_requested') => {
      void Promise.resolve()
        .then(() => triggerEmergency(EMERGENCY_TYPE_FALL, selectedProject?.id))
        .catch((err) => {
          logger.error('FallDetectionMonitor: triggerEmergency failed', { err, originLabel });
        });
    },
    [triggerEmergency, selectedProject],
  );

  const handleFallDetected = () => {
    if (!showModal) {
      setShowModal(true);
      setCountdown(15);

      // §16.2.1: publish the impact to the sensorBus BEFORE the user answers
      // the modal — the correlation engine needs the raw detection either way
      // (a real fall victim may never answer). Non-throwing by contract.
      publishSensorEvent({
        kind: 'fall',
        severity: 'critical',
        workerUid: user?.uid ?? null,
        projectId: selectedProject?.id ?? null,
        value: FALL_THRESHOLD_MS_SQ,
        unit: 'm/s2',
        meta: {
          source: 'FallDetectionMonitor',
          accelWindowMs: FALL_ACCEL_WINDOW_MS,
          // Carry-mode context for the correlation engine / black box: an
          // impact while in_pocket or face_down reads very differently from
          // one while the device is in hand.
          deviceMode: modeState.currentMode,
        },
      });

      // Vibrate to alert the user
      if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 200, 1000]);
      }

      // 16th wave analytics: catalog row 67 (`emergency.fall.detected`).
      // `confidence_pct` is hardcoded at 80 because the threshold-based
      // heuristic doesn't expose a continuous score — when the magnitude
      // crosses the impact threshold we treat it as "high confidence" and
      // let the dashboard tag this detector kind. A future ML model can
      // bump this to a real score.
      try {
        void analytics.track('emergency.fall.detected', {
          confidence_pct: 80,
          accel_window_ms: FALL_ACCEL_WINDOW_MS,
          role_hash: user?.uid ?? 'anonymous',
        });
      } catch { /* analytics must never break user flow */ }
    }
  };

  // D1: the carry-mode policy scales the impact threshold — in_pocket (1.3x)
  // / in_helmet_mount (1.5x) / face_down (2.0x) LOWER the m/s² bar so a
  // muffled pocket impact still triggers the prompt. 'normal' keeps the
  // historical 25 m/s² exactly (multiplier 1.0 — no behavior change without
  // proximity evidence). useAccelerometer reads the threshold via a ref, so
  // the running listener picks up the new value without re-subscribing.
  const { data, start, stop, isSupported, permissionGranted, requestPermission } = useAccelerometer({
    threshold: FALL_THRESHOLD_MS_SQ / policy.fallDetectionMultiplier,
    onFallDetected: handleFallDetected
  });

  // Forward the existing motion stream into the carry-mode classifier —
  // deliberately no second hardware listener (on native, Motion.stop tears
  // down listeners app-wide; fall detection is life-safety).
  useEffect(() => {
    if (data) pushAccelSample(data);
  }, [data, pushAccelSample]);

  useEffect(() => {
    // Opt-in: solo arrancamos el acelerómetro si el usuario activó
    // explícitamente la detección de caída en Settings. Default OFF
    // protege la batería de trabajadores no expuestos a altura.
    if (user && fdEnabled && !fdLoading) {
      start();
    } else {
      stop();
    }
    return () => stop();
  }, [user, fdEnabled, fdLoading, start, stop]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showModal && countdown > 0) {
      timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    } else if (showModal && countdown === 0) {
      // H6 fix: countdown expired without a response → escalate via
      // EmergencyContext (Firestore + global emergency state) AND surface
      // the local toast. Both paths are needed: the toast is the immediate
      // UI feedback, the dispatcher is the persistent audit + supervisor
      // alert path.
      dispatchFallEmergency('countdown_expired');
      addNotification({
        title: 'Posible Caída Detectada',
        message: 'Se ha alertado a los supervisores por falta de respuesta.',
        type: 'error'
      });
      setShowModal(false);
    }
    return () => clearTimeout(timer);
  }, [showModal, countdown, addNotification, dispatchFallEmergency]);

  const handleImOk = () => {
    setShowModal(false);
    addNotification({
      title: 'Falsa Alarma',
      message: 'Has confirmado que estás bien.',
      type: 'success'
    });
  };

  const handleNeedHelp = () => {
    setShowModal(false);
    // H6 fix: the user explicitly requested help → fire the canonical
    // emergency dispatcher immediately (no countdown). Same path as the
    // expiry branch so supervisors see one coherent event stream.
    dispatchFallEmergency('user_requested');
    addNotification({
      title: 'Emergencia Declarada',
      message: 'Se ha notificado a los equipos de rescate.',
      type: 'error'
    });
  };

  if (!user) return null;

  return (
    <AnimatePresence>
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="bg-zinc-900 border border-rose-500/30 rounded-3xl p-6 max-w-sm w-full shadow-2xl shadow-rose-500/20"
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-20 h-20 bg-rose-500/20 rounded-full flex items-center justify-center animate-pulse">
                <AlertTriangle className="w-10 h-10 text-rose-500" />
              </div>
              
              <div>
                <h2 className="text-2xl font-black text-white uppercase tracking-tight">¿Estás bien?</h2>
                <p className="text-zinc-400 mt-2 text-sm">
                  Hemos detectado un movimiento brusco que podría ser una caída.
                </p>
              </div>

              <div className="text-4xl font-black text-rose-500 my-4">
                00:{countdown.toString().padStart(2, '0')}
              </div>

              <div className="w-full space-y-3">
                <button
                  onClick={handleImOk}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  Estoy Bien
                </button>
                <button
                  onClick={handleNeedHelp}
                  className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <AlertTriangle className="w-5 h-5" />
                  Necesito Ayuda
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
