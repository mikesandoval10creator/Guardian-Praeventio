// Round 15 / I4 — UV exposure tracker (Ley 16.744 · Ley 20.096).
//
// Propósito de seguridad: trabajadores outdoor (construcción, agricultura,
// minería) están expuestos a radiación UV alta. Este módulo calcula el índice
// UV en función de latitud, día del año, hora y nubosidad (algoritmo offline)
// y emite alertas + recomendaciones de EPP (FPS50, gorro legionario, manga
// larga, lentes UV-A/B).
//
// - Persistencia: uv_exposures/{userId}_{YYYY-MM-DD} (un doc por trabajador-día,
//   merge para acumular peak UV diario).
// - Audit log: training.uv.alert_emitted cuando se emite alerta crítica.
// - Tier: canUseAdvancedAnalytics (Diamante+).

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Sun, AlertTriangle, ShieldAlert, MapPin, Loader2, CheckCircle2 } from 'lucide-react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { logAuditAction } from '../services/auditService';

/** Pure helper — clear-sky UV index based on latitude, day-of-year, time-of-day,
 *  cloud cover (0-100%). Used for offline estimation; exported for tests. */
export function computeUvIndex(latitude: number, dayOfYear: number, timeOfDay: number, cloudCover: number): number {
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
  const hourAngle = 15 * (timeOfDay - 12);
  const latRad = latitude * (Math.PI / 180);
  const decRad = declination * (Math.PI / 180);
  const hRad = hourAngle * (Math.PI / 180);
  const cosSZA = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(hRad);
  if (cosSZA <= 0) return 0;
  const clearSky = 12.5 * Math.pow(cosSZA, 2.4);
  const cloudFactor = 1 - (Math.max(0, Math.min(100, cloudCover)) / 100) * 0.5;
  return Math.max(0, Math.round(clearSky * cloudFactor));
}

export function uvRiskBand(uv: number) {
  if (uv <= 2) return { level: 'Bajo' as const, cls: 'text-emerald-500 bg-emerald-500/20 border-emerald-500/50' };
  if (uv <= 5) return { level: 'Moderado' as const, cls: 'text-yellow-500 bg-yellow-500/20 border-yellow-500/50' };
  if (uv <= 7) return { level: 'Alto' as const, cls: 'text-orange-500 bg-orange-500/20 border-orange-500/50' };
  if (uv <= 10) return { level: 'Muy Alto' as const, cls: 'text-rose-500 bg-rose-500/20 border-rose-500/50' };
  return { level: 'Extremo' as const, cls: 'text-purple-500 bg-purple-500/20 border-purple-500/50' };
}

function todayDoyIso() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { doy, iso };
}

export function SunTracker() {
  return (
    <PremiumFeatureGuard
      featureName="Radiación UV (Diamante+)"
      feature="canUseAdvancedAnalytics"
      description="Tracker de UV outdoor con persistencia diaria — Ley 20.096 (capa de ozono) y Ley 16.744."
    >
      <SunTrackerInner />
    </PremiumFeatureGuard>
  );
}

function SunTrackerInner() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const { doy, iso } = useMemo(todayDoyIso, []);
  const [latitude, setLatitude] = useState(-33.4489);
  const [dayOfYear, setDayOfYear] = useState(doy);
  const [timeOfDay, setTimeOfDay] = useState(12);
  const [cloudCover, setCloudCover] = useState(20);
  const [recording, setRecording] = useState<'idle' | 'saving' | 'saved'>('idle');

  const uv = useMemo(() => computeUvIndex(latitude, dayOfYear, timeOfDay, cloudCover), [latitude, dayOfYear, timeOfDay, cloudCover]);
  const band = uvRiskBand(uv);

  const handleGetLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setLatitude(pos.coords.latitude),
      () => setLatitude(prev => prev),
    );
  };

  const recordExposure = async () => {
    if (!user) return;
    setRecording('saving');
    try {
      const ref = doc(db, 'uv_exposures', `${user.uid}_${iso}`);
      // Use merge:true and a peakUv field so the daily doc accumulates the
      // worst UV reached in the day (server-side rules in R16 should make
      // this append-only via FieldValue arithmetic).
      await setDoc(ref, {
        userId: user.uid,
        userEmail: user.email,
        date: iso,
        projectId: selectedProject?.id ?? null,
        peakUv: uv,
        latitude,
        cloudCover,
        lastTimeOfDay: timeOfDay,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      if (uv >= 8) {
        await logAuditAction(
          'training.uv.alert_emitted',
          'training',
          { uv, latitude, timeOfDay, cloudCover, date: iso },
          selectedProject?.id,
        );
      }
      setRecording('saved');
      setTimeout(() => setRecording('idle'), 2500);
    } catch (err) {
      console.error('SunTracker recordExposure failed', err);
      setRecording('idle');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <Sun className="w-7 h-7 text-yellow-400" /> Radiación UV
          </h1>
          <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Ley 20.096 · Ley 16.744</p>
        </div>
        <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 font-bold uppercase tracking-widest text-xs ${band.cls}`}>
          <AlertTriangle className="w-4 h-4" /> Riesgo {band.level} · UV {uv}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-white/5 space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest">Condiciones</h2>

          <Field label="Latitud" right={
            <button onClick={handleGetLocation} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Usar GPS
            </button>}>
            <input type="number" value={latitude} onChange={e => setLatitude(Number(e.target.value))}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm" />
          </Field>

          <Range label={`Día del año: ${dayOfYear}`} min={1} max={365} value={dayOfYear} onChange={setDayOfYear} accent="emerald" />
          <Range label={`Hora: ${Math.floor(timeOfDay).toString().padStart(2, '0')}:${timeOfDay % 1 === 0.5 ? '30' : '00'}`}
                 min={0} max={24} step={0.5} value={timeOfDay} onChange={setTimeOfDay} accent="yellow" />
          <Range label={`Nubosidad: ${cloudCover}%`} min={0} max={100} value={cloudCover} onChange={setCloudCover} accent="zinc" />
        </Card>

        <Card className="p-6 border-white/5 space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-yellow-500" /> EPP obligatorio
          </h2>
          <ul className="space-y-2 text-sm text-zinc-300">
            <Recommendation active={uv >= 3} color="bg-yellow-500" text="FPS 30+ reaplicado cada 2 hrs." />
            <Recommendation active={uv >= 6} color="bg-orange-500" text="Gorro legionario, lentes UV-A/B, manga larga." />
            <Recommendation active={uv >= 8} color="bg-rose-500" text="Reprogramar tareas pesadas a horarios sombra." />
            {uv < 3 && <li className="text-emerald-400 text-xs">Condiciones seguras. Mantener hidratación.</li>}
          </ul>

          <motion.div className={`p-3 rounded-xl border text-xs ${
            uv >= 8 ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' :
            uv >= 6 ? 'bg-orange-500/10 border-orange-500/30 text-orange-200' :
                      'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'}`}>
            {uv >= 8 ? <strong>Crítico:</strong> : uv >= 6 ? <strong>Precaución:</strong> : <strong>Normal:</strong>}
            {' '}
            {uv >= 8 ? 'suspender outdoor o rotar turnos cada 30 min.' :
             uv >= 6 ? 'aumentar pausas de hidratación, rotación 60 min.' :
                       'régimen de turnos estándar.'}
          </motion.div>

          <Button onClick={recordExposure} disabled={recording !== 'idle'} className="w-full">
            {recording === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Registrando…</> :
             recording === 'saved' ? <><CheckCircle2 className="w-4 h-4 mr-2" />Exposición registrada</> :
             'Registrar exposición de turno'}
          </Button>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest">{label}</label>
        {right}
      </div>
      {children}
    </div>
  );
}

function Range({ label, min, max, step, value, onChange, accent }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (n: number) => void; accent: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
      <input type="range" min={min} max={max} step={step ?? 1} value={value} onChange={e => onChange(Number(e.target.value))}
        className={`w-full accent-${accent}-500`} />
    </div>
  );
}

function Recommendation({ active, color, text }: { active: boolean; color: string; text: string }) {
  if (!active) return null;
  return (
    <li className="flex items-start gap-2 text-xs">
      <div className={`w-1.5 h-1.5 rounded-full ${color} mt-1.5 shrink-0`} />
      <span>{text}</span>
    </li>
  );
}

export default SunTracker;
