import { useState, useEffect, useRef } from 'react';
import { useRiskEngine } from './useRiskEngine';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useSensors } from '../contexts/SensorContext';
import { NodeType } from '../types';
import { db, collection, addDoc, serverTimestamp } from '../services/firebase';
import { saveBlackBox } from '../utils/offlineStorage';

interface ManDownOptions {
  onManDownConfirmed?: (impactData: { userId?: string; userName?: string; timestamp: string }) => void;
}

export function useManDownDetection(options: ManDownOptions = {}) {
  const { onManDownConfirmed } = options;
  const [isActive, setIsActive] = useState(false);
  const [isAlerting, setIsAlerting] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const lastMovementTime = useRef(Date.now());
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { sensorData, startListening, stopListening } = useSensors();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // Pre-warmed AudioContext (must be created from a user gesture for mobile autoplay policy).
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Sustained-alarm loop refs.
  const alarmIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const alarmTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const acknowledgedRef = useRef<boolean>(false);

  // Rolling acceleration history for jerk-based movement detection (H-mandown fix).
  const accHistoryRef = useRef<number[]>([]);

  // Dynamic thresholds from project settings or defaults
  const INACTIVITY_THRESHOLD = selectedProject?.settings?.manDownInactivityThreshold || 30000;
  const MOVEMENT_THRESHOLD = selectedProject?.settings?.manDownMovementThreshold || 0.5;
  // Jerk threshold for movement detection. Empirical — tune with field data from real
  // miners/construction workers (PPE, gait, vehicle vibration). 1.5 m/s² roughly
  // separates resting hand tremor / vehicle idle from intentional limb motion.
  const JERK_THRESHOLD = 1.5;
  // ~5 samples ≈ 100–200ms at typical DeviceMotion rates (30–60Hz).
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
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
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

  const acknowledgeAlert = () => {
    acknowledgedRef.current = true;
    stopAlarmLoop();
    setIsAlerting(false);
    setCountdown(10);
  };

  const startDetection = () => {
    // Pre-warm shared AudioContext from this user gesture so the sensor-driven
    // alarm later has an unblocked context (Chrome/Safari autoplay policy).
    try {
      if (!audioCtxRef.current) {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
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
    setCountdown(10);
    if (countdownRef.current) clearInterval(countdownRef.current);
    // If the countdown was cancelled before reaching 0, no alarm has started yet,
    // but defensively stop any loop just in case.
    stopAlarmLoop();
  };

  const triggerAlert = async () => {
    // ── Offline-first alarm: fire immediately, no network required ──
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
            console.warn('Error fetching geolocation:', error);
            resolve('Error al obtener ubicación GPS');
          },
          { timeout: 5000 }
        );
      });

      // 1. Add Risk Node
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

      // 2. Send Emergency Message to Crisis Chat
      const messagesRef = collection(db, `projects/${selectedProject.id}/emergency_messages`);
      await addDoc(messagesRef, {
        projectId: selectedProject.id,
        senderId: user.uid,
        senderName: 'SISTEMA AUTOMÁTICO',
        senderRole: 'ALERTA MAN DOWN',
        text: `🚨 ALERTA CRÍTICA: Se ha detectado una posible caída o inmovilidad prolongada del trabajador ${user.displayName || 'Desconocido'}. Ubicación: ${location}`,
        type: 'emergency',
        timestamp: serverTimestamp()
      });

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
      console.error('Error triggering man down alert:', error);
    }
  };

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
      // (gravity vector rotated, magnitude still ≈ 9.8 but per-axis components
      // differ from the assumed orientation). Jerk = |Δacc| over a short window
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
          setCountdown(10);
          if (countdownRef.current) clearInterval(countdownRef.current);
        }
      }
    }
  }, [isActive, sensorData.acceleration, isAlerting, MOVEMENT_THRESHOLD]);

  useEffect(() => {
    if (!isActive) return;

    timerRef.current = setInterval(() => {
      const now = Date.now();
      if (now - lastMovementTime.current > INACTIVITY_THRESHOLD && !isAlerting) {
        setIsAlerting(true);
        // Start countdown
        countdownRef.current = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              triggerAlert();
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
  }, [isActive, isAlerting, selectedProject, user, INACTIVITY_THRESHOLD]);

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
