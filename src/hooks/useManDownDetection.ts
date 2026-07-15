import { useState, useEffect, useRef } from 'react';
import { useRiskEngine } from './useRiskEngine';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useSensors } from '../contexts/SensorContext';
import { useEmergency } from '../contexts/EmergencyContext';
import { NodeType } from '../types';
import { db, collection, addDoc, serverTimestamp } from '../services/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { saveBlackBox } from '../utils/offlineStorage';
import { logger } from '../utils/logger';
import { useSensorBus } from '../services/sensorBus/sensorBus';
import { publishSensorEvent } from '../services/sensorBus/publishSensorEvent';
import {
  evaluateManDownEvidence,
  LOCAL_DEVICE_UID,
  BATTERY_EVIDENCE_WINDOW_MS,
  MANDOWN_COUNTDOWN_DEFAULT_S,
  MANDOWN_COUNTDOWN_CRITICAL_S,
} from '../services/sensorBus/manDownCorrelation';
import { getBatterySnapshot } from '../services/battery/batteryAdvisor';

// Republish battery evidence one minute before the correlation window closes so
// a downed worker's battery state stays fresh for the engine. Module-scoped: it
// derives only from a compile-time constant, so it is never a hook dependency.
const BATTERY_REPUBLISH_MS = BATTERY_EVIDENCE_WINDOW_MS - 60_000;

interface ManDownOptions {
  onManDownConfirmed?: (impactData: { userId?: string; userName?: string; timestamp: string }) => void;
}

export function useManDownDetection(options: ManDownOptions = {}) {
  const { onManDownConfirmed } = options;
  const [isActive, setIsActive] = useState(false);
  const [isAlerting, setIsAlerting] = useState(false);
  const [countdown, setCountdown] = useState(MANDOWN_COUNTDOWN_DEFAULT_S);
  const lastMovementTime = useRef(Date.now());
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { sensorData, startListening, stopListening } = useSensors();
  const { triggerEmergency } = useEmergency();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  // Stores the Firestore mandown_events doc so acknowledgeAlert() can update it
  const mandownEventRef = useRef<{ projectId: string; docId: string } | null>(null);

  // Pre-warmed AudioContext (must be created from a user gesture for mobile autoplay policy).
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Sustained-alarm loop refs.
  const alarmIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const alarmTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const acknowledgedRef = useRef<boolean>(false);

  // Rolling acceleration history for jerk-based movement detection (H-mandown fix).
  const accHistoryRef = useRef<number[]>([]);

  // Live mirror of `isAlerting` for the interval closures below. CRITICAL: the
  // inactivity effect must NOT list `isAlerting` in its deps. Doing so tore the
  // effect down the instant the alert was raised, and its cleanup cleared the
  // freshly created countdown interval before it could reach 0 — so
  // triggerAlert() NEVER fired and the alert silently never escalated. Reading
  // a ref keeps the 1s timer current without re-subscribing the effect. Bug
  // found by the first-ever test of this hook (2026-05-29); it had 0% coverage.
  const isAlertingRef = useRef<boolean>(false);

  // Dynamic thresholds from project settings or defaults
  const INACTIVITY_THRESHOLD = selectedProject?.settings?.manDownInactivityThreshold || 30000;
  const MOVEMENT_THRESHOLD = selectedProject?.settings?.manDownMovementThreshold || 0.5;
  // Jerk threshold for movement detection. Empirical — tune with field data from real
  // miners/construction workers (PPE, gait, vehicle vibration). 1.5 m/s² roughly
  // separates resting hand tremor / vehicle idle from intentional limb motion.
  const JERK_THRESHOLD = 1.5;
  // ~5 samples â‰ˆ 100–200ms at typical DeviceMotion rates (30–60Hz).
  const JERK_WINDOW = 5;

  // Sustained alarm parameters (B9).
  const ALARM_MIN_DURATION_MS = 30000; // at least 30s for unconscious-worker discoverability
  const ALARM_PULSE_ON_MS = 2000;
  const ALARM_PULSE_OFF_MS = 500;

  const stopAlarmLoop = () => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    if (alarmTimeoutRef.current) {
      clearTimeout(alarmTimeoutRef.current);
      alarmTimeoutRef.current = null;
    }
    try { navigator.vibrate?.(0); } catch {}
  };

  const playOneAlarmPulse = () => {
    // Vibration: pulse pattern. Best-effort — iOS Safari has no vibrate API.
    try { navigator.vibrate?.([1000, 200, 1000, 200]); } catch {}
    // Audio: reuse the pre-warmed AudioContext (B-related fix). Fallback to a fresh
    // one if it was never primed (best-effort; mobile may keep it suspended).
    try {
      let ctx = audioCtxRef.current;
      if (!ctx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;
        ctx = new AudioCtxClass() as AudioContext;
        audioCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const osc = ctx.createOscillator();
      osc.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      osc.start();
      setTimeout(() => { try { osc.stop(); osc.disconnect(); } catch {} }, ALARM_PULSE_ON_MS);
    } catch {}
  };

  const startAlarmLoop = () => {
    acknowledgedRef.current = false;
    stopAlarmLoop();
    // Fire first pulse immediately, then every ON+OFF cycle.
    playOneAlarmPulse();
    alarmIntervalRef.current = setInterval(() => {
      if (acknowledgedRef.current) {
        stopAlarmLoop();
        return;
      }
      playOneAlarmPulse();
    }, ALARM_PULSE_ON_MS + ALARM_PULSE_OFF_MS);
    // Hard floor: keep alarm running for at least ALARM_MIN_DURATION_MS.
    // After the minimum, the loop continues until acknowledgeAlert() is called.
    alarmTimeoutRef.current = setTimeout(() => {
      // Intentional no-op marker: minimum duration reached. Loop continues until acknowledged.
      alarmTimeoutRef.current = null;
    }, ALARM_MIN_DURATION_MS);
  };

  const acknowledgeAlert = async () => {
    acknowledgedRef.current = true;
    stopAlarmLoop();
    setIsAlerting(false);
    setCountdown(MANDOWN_COUNTDOWN_DEFAULT_S);

    const ref = mandownEventRef.current;
    mandownEventRef.current = null;
    if (!ref) return;
    try {
      await updateDoc(doc(db, `projects/${ref.projectId}/mandown_events`, ref.docId), {
        status: 'acknowledged',
        acknowledgedBy: user?.uid ?? null,
        acknowledgedByName: user?.displayName ?? null,
        acknowledgedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[ManDown] acknowledgeAlert Firestore write failed — queuing retry:', err);
      logger.error('useManDownDetection: failed to acknowledge event', { err });
      // Re-arm the alarm so the acknowledgment doesn't silently disappear
      acknowledgedRef.current = false;
      mandownEventRef.current = ref;
      setIsAlerting(true);
      startAlarmLoop();
    }
  };

  // ── sensorBus wiring (TODO.md §16.2.1) ────────────────────────────────
  // Battery evidence republish cadence: stay fresh inside the engine's
  // 5-min evidence window with 1 min of slack.
  const lastBatteryPublishRef = useRef(0);

  // Publishes the current battery snapshot to the sensor bus so the
  // correlation engine can use "battery critical" as escalation evidence.
  // batteryAdvisor stays pure-ish (no bus dependency) — we bridge here.
  const publishBatteryEvidence = async () => {
    try {
      const snap = await getBatterySnapshot();
      if (snap.level == null) return; // Battery API unavailable → no evidence.
      publishSensorEvent({
        kind: 'battery',
        severity:
          snap.mode === 'critical' ? 'critical' : snap.mode === 'normal' ? 'info' : 'warning',
        workerUid: user?.uid ?? null,
        projectId: selectedProject?.id ?? null,
        value: snap.level,
        unit: 'fraction',
        meta: { charging: snap.charging, mode: snap.mode },
      });
    } catch (err) {
      // Evidence publishing must never break detection (life-safety first).
      logger.warn('useManDownDetection: battery evidence publish failed', { err });
    }
  };

  const startDetection = () => {
    // Pre-warm shared AudioContext from this user gesture so the sensor-driven
    // alarm later has an unblocked context (Chrome/Safari autoplay policy).
    try {
      if (!audioCtxRef.current) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass) {
          audioCtxRef.current = new AudioCtxClass() as AudioContext;
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    } catch {}

    setIsActive(true);
    startListening();
    lastMovementTime.current = Date.now();
    accHistoryRef.current = [];
    // Seed battery evidence on the bus (refreshed periodically below).
    lastBatteryPublishRef.current = Date.now();
    void publishBatteryEvidence();
  };

  const stopDetection = () => {
    setIsActive(false);
    setIsAlerting(false);
    stopListening();
    if (timerRef.current) clearInterval(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    stopAlarmLoop();
  };

  const cancelCountdown = () => {
    setIsAlerting(false);
    setCountdown(MANDOWN_COUNTDOWN_DEFAULT_S);
    if (countdownRef.current) clearInterval(countdownRef.current);
    // If the countdown was cancelled before reaching 0, no alarm has started yet,
    // but defensively stop any loop just in case.
    stopAlarmLoop();
  };

  const triggerAlert = async () => {
    // â”€â”€ Offline-first alarm: fire immediately, no network required â”€â”€
    // B9: sustained loop instead of single 3s burst.
    startAlarmLoop();

    if (!selectedProject || !user) return;

    // Dump last telemetry snapshot to black box before any network call
    const impactTimestamp = new Date().toISOString();
    await saveBlackBox(user.uid, {
      userId: user.uid,
      userName: user.displayName,
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      acceleration: sensorData.acceleration,
      inactivityMs: INACTIVITY_THRESHOLD,
      timestamp: impactTimestamp,
    }).catch(() => {}); // silently fail — safety data has priority

    // Dispatch the emergency pipeline → FCM push to project supervisors. THIS is
    // the life-safety gap (B1): without it, a downed/unconscious worker whose
    // phone is backgrounded never wakes the supervisor — the `mandown_events`
    // doc written below is only seen if someone is already watching. Mirrors
    // FallDetectionMonitor's `triggerEmergency('fall', …)`. Fire-and-forget so
    // it runs concurrently with the record writes; a dispatch failure must NEVER
    // break the local alarm or the auditable Firestore record.
    void triggerEmergency('man_down', selectedProject.id).catch((err) =>
      logger.error('useManDownDetection: triggerEmergency failed', { err }),
    );

    try {
      const location = await new Promise<string>((resolve) => {
        if (!navigator.geolocation) {
          resolve('Ubicación GPS no soportada por el navegador');
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve(`${position.coords.latitude}, ${position.coords.longitude}`);
          },
          (error) => {
            logger.warn('Error fetching geolocation:', { code: error.code, message: error.message });
            resolve('Error al obtener ubicación GPS');
          },
          { timeout: 5000 }
        );
      });

      // 1. CRITICAL FIRST — the auditable mandown_event is the input the
      //    supervisor-escalation cron reads. It MUST be written even if the
      //    decorative risk-node / crisis-chat writes fail, so it goes first and
      //    is NOT gated on them (audit 2026-07-02 §3.1: previously it was LAST in
      //    the chain, so any earlier write failure skipped it silently).
      //
      // Sprint 12 — when an `accidente de trayecto` commute session is active
      // for this project, decorate the event with `tipo: 'trayecto'` so
      // SUSESO reporting (Ley 16.744) can classify it without a follow-up
      // form. The tag is informational; the lifecycle remains the same.
      const { tagIncidentTipo, getActiveSession } = await import('../services/driving/commuteSession');
      const tagged = tagIncidentTipo(
        {
          projectId: selectedProject.id,
          workerId: user.uid,
          workerName: user.displayName ?? null,
          location,
          status: 'active',
          triggeredAt: serverTimestamp(),
          acknowledgedBy: null,
          acknowledgedAt: null,
        },
        getActiveSession(),
      );
      const eventRef = await addDoc(
        collection(db, `projects/${selectedProject.id}/mandown_events`),
        tagged,
      );
      mandownEventRef.current = { projectId: selectedProject.id, docId: eventRef.id };

      // 2. Best-effort Risk Node (Red Neuronal graph) — must NOT abort escalation.
      try {
        await addNode({
          type: NodeType.EMERGENCY,
          title: `ALERTA: Hombre Caído - ${user.displayName || 'Trabajador'}`,
          description: `Se ha detectado una posible caída o inmovilidad prolongada del trabajador en el proyecto ${selectedProject.name}.`,
          tags: ['Emergencia', 'Hombre Caído', 'Crítico'],
          projectId: selectedProject.id,
          connections: [],
          metadata: {
            type: 'Man Down',
            userId: user.uid,
            userName: user.displayName,
            timestamp: new Date().toISOString(),
            status: 'Activa',
            location: location
          }
        });
      } catch (nodeErr) {
        logger.warn('mandown: risk-node write failed (non-blocking)', { error: nodeErr });
      }

      // 3. Best-effort Crisis-Chat broadcast — must NOT abort escalation.
      try {
        const messagesRef = collection(db, `projects/${selectedProject.id}/emergency_messages`);
        await addDoc(messagesRef, {
          projectId: selectedProject.id,
          senderId: user.uid,
          senderName: 'SISTEMA AUTOMÁTICO',
          senderRole: 'ALERTA MAN DOWN',
          text: `ðŸš¨ ALERTA CRÍTICA: Se ha detectado una posible caída o inmovilidad prolongada del trabajador ${user.displayName || 'Desconocido'}. Ubicación: ${location}`,
          type: 'emergency',
          timestamp: serverTimestamp()
        });
      } catch (chatErr) {
        logger.warn('mandown: crisis-chat write failed (non-blocking)', { error: chatErr });
      }

      // NOTE: do NOT clear isAlerting here — the supervisor must explicitly
      // acknowledge via acknowledgeAlert() to silence the local alarm. This
      // prevents the alarm from going quiet just because the network call
      // succeeded, which would defeat the "attract nearby rescuers" purpose.
      setCountdown(0);

      // Notify consumers so they can show TriageBeacon or other UI
      onManDownConfirmed?.({
        userId: user.uid,
        userName: user.displayName || undefined,
        timestamp: impactTimestamp,
      });
    } catch (error) {
      logger.error('Error triggering man down alert:', error);
    }
  };

  // Keep the alerting ref in sync with state for the interval closures.
  useEffect(() => {
    isAlertingRef.current = isAlerting;
  }, [isAlerting]);

  useEffect(() => {
    if (!isActive) return;

    const { x, y, z } = sensorData.acceleration;
    if (x !== null && y !== null && z !== null) {
      const totalAcc = Math.sqrt(
        (x || 0) ** 2 +
        (y || 0) ** 2 +
        (z || 0) ** 2
      );

      // H-mandown fix: jerk-based movement detection. The previous
      // |totalAcc - 9.8| heuristic broke when the device rested at an angle
      // (gravity vector rotated, magnitude still â‰ˆ 9.8 but per-axis components
      // differ from the assumed orientation). Jerk = |Î”acc| over a short window
      // is orientation-invariant.
      const history = accHistoryRef.current;
      history.push(totalAcc);
      if (history.length > JERK_WINDOW) history.shift();

      let jerk = 0;
      for (let i = 1; i < history.length; i++) {
        const d = Math.abs(history[i] - history[i - 1]);
        if (d > jerk) jerk = d;
      }

      // Keep MOVEMENT_THRESHOLD as a secondary fallback in case sensor quirks
      // produce flat jerk despite real movement (project setting still respected).
      const isMoving =
        jerk > JERK_THRESHOLD ||
        Math.abs(totalAcc - 9.8) > MOVEMENT_THRESHOLD * 4;

      if (isMoving) {
        lastMovementTime.current = Date.now();
        if (isAlerting) {
          setIsAlerting(false);
          setCountdown(MANDOWN_COUNTDOWN_DEFAULT_S);
          if (countdownRef.current) clearInterval(countdownRef.current);
        }
      }
    }
  }, [isActive, sensorData.acceleration, isAlerting, MOVEMENT_THRESHOLD]);

  // Latest-closure refs: the detection interval below is long-lived (keyed only
  // on isActive/selectedProject/user/threshold so it isn't torn down every
  // render). Calling triggerAlert/publishBatteryEvidence directly would capture
  // a STALE closure — notably triggerAlert reads sensorData.acceleration for the
  // black box, so a captured version would record acceleration from when the
  // effect last ran, not from the impact. Route both through refs kept current.
  const triggerAlertRef = useRef(triggerAlert);
  const publishBatteryEvidenceRef = useRef(publishBatteryEvidence);
  useEffect(() => {
    triggerAlertRef.current = triggerAlert;
    publishBatteryEvidenceRef.current = publishBatteryEvidence;
  });

  useEffect(() => {
    if (!isActive) return undefined;

    timerRef.current = setInterval(() => {
      const now = Date.now();
      // Keep the battery evidence fresh inside the engine's window.
      if (now - lastBatteryPublishRef.current >= BATTERY_REPUBLISH_MS) {
        lastBatteryPublishRef.current = now;
        void publishBatteryEvidenceRef.current();
      }
      if (now - lastMovementTime.current > INACTIVITY_THRESHOLD && !isAlertingRef.current) {
        // §16.2.1: publish sustained immobility FIRST so both the bus's own
        // fall+inactivity+ble-off rule and the evaluation below can see it.
        publishSensorEvent({
          kind: 'inactivity',
          severity: 'warning',
          workerUid: user?.uid ?? null,
          projectId: selectedProject?.id ?? null,
          value: now - lastMovementTime.current,
          unit: 'ms',
          meta: { source: 'useManDownDetection' },
        });
        // Multi-sensor correlation (anti-false-positive, TODO.md §16.2.1):
        // impact + immobility + (BLE disconnected | battery critical) on the
        // bus ⇒ 'critical' ⇒ reduced self-cancel countdown. With no extra
        // evidence the verdict is 'none'/'suspect' and the DEFAULT 10s flow
        // is untouched — the bus only ever ADDS confidence, never blocks.
        let startCountdownS = MANDOWN_COUNTDOWN_DEFAULT_S;
        try {
          const evidence = evaluateManDownEvidence(
            Array.from(useSensorBus.getState().readings.values()),
            new Date(now),
            { workerUid: user?.uid ?? LOCAL_DEVICE_UID },
          );
          if (evidence.level === 'critical') {
            startCountdownS = MANDOWN_COUNTDOWN_CRITICAL_S;
            logger.warn(
              'useManDownDetection: critical multi-sensor evidence — reduced countdown',
              { reasons: evidence.reasons },
            );
          }
        } catch (err) {
          // Correlation failures must never delay or break the alert.
          logger.error('useManDownDetection: evidence evaluation failed', { err });
        }
        setIsAlerting(true);
        // Mirror immediately so the next 1s tick (before React commits the
        // state) doesn't stack a second countdown.
        isAlertingRef.current = true;
        setCountdown(startCountdownS);
        // Start countdown
        countdownRef.current = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              triggerAlertRef.current();
              if (countdownRef.current) clearInterval(countdownRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // NOTE: `isAlerting` is intentionally NOT a dependency — see isAlertingRef
    // above. Listing it here destroyed the countdown the moment the alert
    // raised, so the escalation never fired.
  }, [isActive, selectedProject, user, INACTIVITY_THRESHOLD]);

  // Clean teardown on unmount: kill any pending alarm pulses, intervals, and
  // close the AudioContext so we don't leak audio nodes between sessions.
  useEffect(() => {
    return () => {
      stopAlarmLoop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
    };
  }, []);

  return {
    isActive,
    isAlerting,
    countdown,
    startDetection,
    stopDetection,
    cancelCountdown,
    acknowledgeAlert,
  };
}
