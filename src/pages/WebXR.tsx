// Round 15 / I4 — Capacitación EPP en altura con WebXR / AR.
//
// Propósito de seguridad: entrenamiento inmersivo de trabajo en altura
// (>1.8 m, DS 594 Art. 53). El operario activa la cámara/headset y revisa una
// checklist de fall-arrest (arnés, anclaje, línea de vida, casco con barbiquejo)
// con marcadores AR sobre el equipamiento. Al completar, persiste en
// `safety_trainings/{id}` y emite audit `training.webxr.completed`.
//
// La parte técnica de WebXR full (immersive-vr / immersive-ar) queda para
// Round 16 — esta versión usa getUserMedia + overlays HTML que funciona en
// cualquier navegador moderno (incluido Cardboard via stereo CSS si fuera
// necesario más adelante).
//
// - Tier: canUseAdvancedAnalytics (Diamante+).

import React, { useEffect, useRef, useState } from 'react';
import { Camera, AlertTriangle, CheckCircle2, X, Loader2, ShieldCheck, Award } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { logAuditAction } from '../services/auditService';

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  /** % overlay position (relative to camera frame) */
  x: number;
  y: number;
}

const HEIGHT_WORK_CHECKLIST: ChecklistItem[] = [
  { id: 'harness', title: 'Arnés cuerpo completo',
    description: 'Verificar fechas de inspección, costuras, hebillas y argollas dorsal/torácica/lateral.',
    x: 50, y: 50 },
  { id: 'anchor', title: 'Punto de anclaje 22 kN',
    description: 'Anclaje certificado para fuerza mínima de detención de 22 kN según NCh 1258.',
    x: 30, y: 25 },
  { id: 'lifeline', title: 'Línea de vida + absorbedor',
    description: 'Línea con absorbedor de energía, longitud máxima que evita golpe contra estructura inferior.',
    x: 70, y: 30 },
  { id: 'helmet', title: 'Casco clase E con barbiquejo',
    description: 'Casco dieléctrico clase E (20 kV) con barbiquejo de 4 puntos para retención en caída.',
    x: 50, y: 15 },
];

export default function WebXR() {
  return (
    <PremiumFeatureGuard
      featureName="Capacitación AR — Trabajo en Altura (Diamante+)"
      feature="canUseAdvancedAnalytics"
      description="Entrenamiento inmersivo de fall-arrest según DS 594 Art. 53. Marca cada elemento del EPP usando la cámara del dispositivo."
    >
      <WebXRInner />
    </PremiumFeatureGuard>
  );
}

function WebXRInner() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [activeMarker, setActiveMarker] = useState<ChecklistItem | null>(null);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [trainingId, setTrainingId] = useState<string | null>(null);
  // Round 18 (R5): track when the AR scan started so we can record
  // `durationMin` on the `training.webxr.completed` audit log. The
  // curriculum aggregator's `stats.safeHours` only sums `safety.*`
  // events, but logging the duration here keeps the schema consistent
  // for future training-vs-safety dashboards.
  const [scanStartedAtMs, setScanStartedAtMs] = useState<number | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (isScanning) {
      // Round 18 (R5): mark the start of the AR scan exactly once per
      // "Iniciar AR" → "Detener" cycle. Re-starting resets the clock.
      setScanStartedAtMs(Date.now());
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
        .catch(() => setError('No se pudo acceder a la cámara. Verifique los permisos.'));
    }
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, [isScanning]);

  const verifyItem = (id: string) => {
    setVerified(prev => {
      const n = new Set(prev); n.add(id); return n;
    });
    setActiveMarker(null);
  };

  const allVerified = verified.size === HEIGHT_WORK_CHECKLIST.length;

  const completeTraining = async () => {
    if (!user || !allVerified) return;
    setSavingState('saving');
    try {
      const docRef = await addDoc(collection(db, 'safety_trainings'), {
        projectId: selectedProject?.id ?? null,
        traineeUid: user.uid,
        traineeEmail: user.email,
        traineeName: user.displayName ?? null,
        type: 'webxr.height-work',
        normativa: 'DS 594 Art. 53',
        verifiedItems: Array.from(verified),
        completedAt: serverTimestamp(),
      });
      setTrainingId(docRef.id);
      // Round 18 (R5): forward `durationMin` (scan-start → completion).
      // We only attach it when the scan timer is set; if the user somehow
      // bypassed the camera flow we omit the field rather than emitting a 0.
      const auditDetails: Record<string, unknown> = {
        trainingId: docRef.id,
        type: 'webxr.height-work',
        items: verified.size,
      };
      if (scanStartedAtMs) {
        auditDetails.durationMin = Math.max(
          1,
          Math.ceil((Date.now() - scanStartedAtMs) / 60_000),
        );
      }
      await logAuditAction(
        'training.webxr.completed',
        'training',
        auditDetails,
        selectedProject?.id,
      );
      setSavingState('saved');
    } catch (err) {
      console.error('WebXR training save failed', err);
      setSavingState('idle');
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Capacitación AR — Trabajo en Altura</h1>
          <p className="text-sm text-gray-500">DS 594 Art. 53 · Marca cada elemento de EPP</p>
        </div>
        <button
          onClick={() => setIsScanning(!isScanning)}
          className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${
            isScanning ? 'bg-rose-100 text-rose-700' : 'bg-indigo-600 text-white'
          }`}
        >
          <Camera className="w-5 h-5" />
          {isScanning ? 'Detener' : 'Iniciar AR'}
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(verified.size / HEIGHT_WORK_CHECKLIST.length) * 100}%` }} />
        </div>
        <span className="font-bold text-zinc-600 dark:text-zinc-300">
          {verified.size}/{HEIGHT_WORK_CHECKLIST.length} verificados
        </span>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" /> {error}
        </div>
      )}

      <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video shadow-xl">
        {!isScanning ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <Camera className="w-16 h-16 mb-4 opacity-50" />
            <p>Inicie AR para activar marcadores</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            <AnimatePresence>
              {HEIGHT_WORK_CHECKLIST.map(item => {
                const ok = verified.has(item.id);
                return (
                  <motion.button
                    key={item.id}
                    initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                    onClick={() => setActiveMarker(item)}
                    style={{ left: `${item.x}%`, top: `${item.y}%` }}
                    aria-label={`Verificar ${item.title}`}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center border-2 border-white shadow-lg ${
                      ok ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                    }`}>
                    {ok ? <CheckCircle2 className="w-6 h-6 text-white" /> : <ShieldCheck className="w-6 h-6 text-white" />}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </>
        )}
      </div>

      <AnimatePresence>
        {activeMarker && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-gray-200 dark:border-zinc-800 p-6">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{activeMarker.title}</h3>
              <button onClick={() => setActiveMarker(null)} aria-label="Cerrar"
                className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-zinc-400 mb-4">{activeMarker.description}</p>
            <button onClick={() => verifyItem(activeMarker.id)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Marcar como verificado
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {allVerified && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-wrap items-center gap-3">
          <Award className="w-6 h-6 text-emerald-500" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Checklist completa</p>
            <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
              Registra esta capacitación en tu historial.
            </p>
          </div>
          <button onClick={completeTraining} disabled={savingState !== 'idle'}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium flex items-center gap-2 disabled:opacity-50">
            {savingState === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</> :
             savingState === 'saved' ? <><CheckCircle2 className="w-4 h-4" /> Capacitación registrada</> :
             'Registrar capacitación'}
          </button>
          {trainingId && (
            <p className="w-full text-[10px] text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-widest">
              ID: {trainingId}
            </p>
          )}
        </motion.div>
      )}
    </div>
  );
}
