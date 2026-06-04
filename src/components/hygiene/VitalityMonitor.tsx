import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Battery, Droplets, ThermometerSun, Mountain, Hammer, AlertTriangle, HeartPulse } from 'lucide-react';
import { Card } from '../shared/Card';
import { MedicalDisclaimer } from '../health/MedicalDisclaimer';
import { useHealthMetrics } from '../../hooks/useHealthMetrics';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { logger } from '../../utils/logger';
import { useProject } from '../../contexts/ProjectContext';
import { evaluateSafetyRecommendations } from './vitalitySignals';

// ADR 0012 — Praeventio NUNCA diagnostica. Este monitor observa SEÑALES
// fisiológicas/ambientales (frecuencia cardíaca, calor, carga) y emite
// RECOMENDACIONES de seguridad NO diagnósticas (pausa, hidratación, buscar
// evaluación médica) vía `evaluateSafetyRecommendations` — nunca infiere
// enfermedades ni asigna códigos CIE-10 (eso es del médico tratante).

export function VitalityMonitor() {
  const [temperature, setTemperature] = useState(25);
  const [altitude, setAltitude] = useState(1000); // meters
  const [toolWeight, setToolWeight] = useState(5); // kg
  const [vitality, setVitality] = useState(100);
  const [hydrationNeeded, setHydrationNeeded] = useState(false);
  const { selectedProject } = useProject();
  const metrics = useHealthMetrics({ autoSyncMs: 60_000 });
  // Avoid duplicate Firestore writes for the same trigger window.
  const lastAlertedRef = useRef<Set<string>>(new Set());

  // Detect HR sustained > 120 bpm for ~5min, and HR irregularity
  // (RMSSD-style proxy: stdev of recent samples > threshold).
  const heartStats = useMemo(() => {
    const samples = metrics.heartRateRecent;
    if (samples.length < 3) {
      return { sustainedHigh: false, irregular: false, latestBpm: null as number | null };
    }
    const fiveMinAgo = Date.now() - 5 * 60_000;
    const recent = samples.filter((s) => s.timestamp >= fiveMinAgo);
    const allHigh = recent.length >= 3 && recent.every((s) => s.bpm > 120);
    const bpms = recent.map((s) => s.bpm);
    const mean = bpms.reduce((a, b) => a + b, 0) / Math.max(1, bpms.length);
    const variance = bpms.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, bpms.length);
    const stdev = Math.sqrt(variance);
    const irregular = stdev > 25; // bpm stdev — heuristic
    return {
      sustainedHigh: allHigh,
      irregular,
      latestBpm: bpms[bpms.length - 1] ?? null,
    };
  }, [metrics.heartRateRecent]);

  // Heuristic: < 1000 steps "después de 16h" — we approximate "shift end"
  // with local time after 16:00.
  const isShiftLate = new Date().getHours() >= 16;
  const stepsLowAfterShift =
    isShiftLate && (metrics.stepsToday ?? 9999) < 1000;

  const recommendations = useMemo(
    () =>
      evaluateSafetyRecommendations({
        hrSustainedHigh: heartStats.sustainedHigh,
        hrIrregular: heartStats.irregular,
        stepsLowAfterShift,
        temperature,
        toolWeight,
      }),
    [heartStats, stepsLowAfterShift, temperature, toolWeight],
  );

  // Persist NON-diagnostic safety recommendations to Firestore once per trigger
  // window (per session). We store the observed signal + suggested action —
  // never a diagnosis or clinical code (ADR 0012).
  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId || recommendations.length === 0) return;
    for (const rec of recommendations) {
      const dedupKey = rec.signal;
      if (lastAlertedRef.current.has(dedupKey)) continue;
      lastAlertedRef.current.add(dedupKey);
      void (async () => {
        try {
          await addDoc(collection(db, `projects/${projectId}/clinical_alerts`), {
            signal: rec.signal,
            severity: rec.severity,
            recommendation: rec.recommendation,
            source: metrics.source,
            heartRateBpm: heartStats.latestBpm,
            stepsToday: metrics.stepsToday ?? null,
            temperature,
            altitude,
            toolWeight,
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser?.uid ?? null,
          });
        } catch (err) {
          logger.warn('[VitalityMonitor] No se pudo persistir la recomendación', err);
        }
      })();
    }
  }, [
    recommendations,
    selectedProject?.id,
    metrics.source,
    metrics.stepsToday,
    heartStats.latestBpm,
    temperature,
    altitude,
    toolWeight,
  ]);

  useEffect(() => {
    // Calculate vitality drain based on environmental factors
    // Base drain is 10% per hour.
    // High temp (>30C) adds drain.
    // High altitude (>2500m) adds drain.
    // Heavy tools (>10kg) adds drain.

    let drainRate = 10;
    if (temperature > 30) drainRate += (temperature - 30) * 2;
    if (altitude > 2500) drainRate += (altitude - 2500) / 100;
    if (toolWeight > 10) drainRate += (toolWeight - 10) * 1.5;

    // Simulate vitality dropping over a "shift" (accelerated for demo)
    const interval = setInterval(() => {
      setVitality(prev => {
        const next = Math.max(0, prev - (drainRate / 60)); // drain per minute simulated
        if (next < 40) setHydrationNeeded(true);
        return next;
      });
    }, 1000); // Update every second for demo purposes

    return () => clearInterval(interval);
  }, [temperature, altitude, toolWeight]);

  const handleHydrate = () => {
    setVitality(Math.min(100, vitality + 30));
    setHydrationNeeded(false);
  };

  const getBatteryColor = () => {
    if (vitality > 70) return 'text-emerald-500 bg-emerald-500';
    if (vitality > 40) return 'text-yellow-500 bg-yellow-500';
    return 'text-rose-500 bg-rose-500';
  };

  return (
    <Card className="p-6 border-white/5 space-y-6 relative overflow-hidden">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Battery className={`w-5 h-5 ${getBatteryColor().split(' ')[0]}`} />
            Monitor de Vitalidad
          </h3>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
            Energía y Desgaste Físico
          </p>
        </div>
        <div className="text-right">
          <span className={`text-2xl font-black ${getBatteryColor().split(' ')[0]}`}>
            {Math.round(vitality)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1">
            <ThermometerSun className="w-3 h-3" /> Temp (°C)
          </label>
          <input
            type="number"
            value={temperature}
            onChange={e => setTemperature(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1">
            <Mountain className="w-3 h-3" /> Altitud (m)
          </label>
          <input
            type="number"
            value={altitude}
            onChange={e => setAltitude(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1">
            <Hammer className="w-3 h-3" /> Carga (kg)
          </label>
          <input
            type="number"
            value={toolWeight}
            onChange={e => setToolWeight(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
          />
        </div>
      </div>

      <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${getBatteryColor().split(' ')[1]}`}
          animate={{ width: `${vitality}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Vitales en tiempo real (HealthKit / Health Connect / BLE) — on-device. */}
      {(metrics.source !== 'mock' || heartStats.latestBpm != null) && (
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-zinc-900/40 border border-white/5 p-3">
          <div className="text-center">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center justify-center gap-1">
              <HeartPulse className="w-3 h-3" /> HR
            </p>
            <p className={`text-lg font-black ${heartStats.sustainedHigh ? 'text-rose-500' : 'text-emerald-400'}`}>
              {heartStats.latestBpm ?? '--'} <span className="text-[10px] font-bold">bpm</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Pasos</p>
            <p className="text-lg font-black text-blue-300">
              {metrics.stepsToday != null ? metrics.stepsToday.toLocaleString() : '--'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Fuente</p>
            <p className="text-[10px] font-black text-teal-300 uppercase">
              {metrics.source.replace('-', ' ')}
            </p>
          </div>
        </div>
      )}

      {/* Recomendaciones de seguridad NO diagnósticas (señal + acción). */}
      {recommendations.length > 0 && (
        <div className="rounded-xl bg-rose-500/5 border border-rose-500/30 p-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Recomendaciones de seguridad
          </p>
          {recommendations.map((r) => (
            <div key={r.signal} className="space-y-0.5">
              <p className="text-[10px] font-bold text-zinc-200">{r.signal}</p>
              <p className="text-[10px] text-zinc-400">{r.recommendation}</p>
            </div>
          ))}
        </div>
      )}

      {hydrationNeeded && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-between"
        >
          <div className="flex items-center gap-2 text-blue-400">
            <Droplets className="w-4 h-4 shrink-0" />
            <p className="text-xs font-bold">¡Receso de hidratación sugerido!</p>
          </div>
          <button
            onClick={handleHydrate}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors"
          >
            Hidratar
          </button>
        </motion.div>
      )}

      {/* ADR 0012 — recordatorio permanente: la app no diagnostica. */}
      <MedicalDisclaimer variant="compact" className="pt-1" />
    </Card>
  );
}
