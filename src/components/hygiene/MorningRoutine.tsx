import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, ArrowRight, CheckCircle2, Timer, Activity, Heart, Shield, BookOpen, Sparkles } from 'lucide-react';
import { Card } from '../shared/Card';
import { WisdomCapsule } from '../shared/WisdomCapsule';
import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  handleFirestoreError,
  OperationType,
} from '../../services/firebase';
import { awardPoints } from '../../services/gamificationService';
import { useProject } from '../../contexts/ProjectContext';
import { apiAuthHeader } from '../../lib/apiAuth';

/**
 * Sprint 25 — Bucket SS.3: persist a morning check-in summary at
 * `users/{uid}/morning_checkins/{YYYY-MM-DD}` once the routine
 * completes. Document is keyed by the local date so the duplicate guard
 * is just a `getDoc` on today's path. Fields:
 *   { date, completedAt (serverTimestamp), sleepHours?, mood?,
 *     energyLevel?, notes? }
 *
 * The component currently ships the stretch flow only; sleepHours/mood/
 * energyLevel/notes are reserved for the upcoming form expansion. We
 * still persist the date+completedAt today so the duplicate-prevention
 * contract is testable end-to-end.
 */
interface MorningCheckInDoc {
  date: string;
  completedAt: unknown; // serverTimestamp sentinel | Timestamp on read
  sleepHours?: number;
  mood?: number;
  energyLevel?: number;
  notes?: string;
}

export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Internal helper extracted for tests (no React, no timers). */
export async function persistMorningCheckIn(
  uid: string,
  payload: Omit<MorningCheckInDoc, 'completedAt'>,
): Promise<{ saved: boolean; duplicate: boolean }> {
  const ref = doc(db, 'users', uid, 'morning_checkins', payload.date);
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      return { saved: false, duplicate: true };
    }
    await setDoc(ref, { ...payload, completedAt: serverTimestamp() });
    return { saved: true, duplicate: false };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'users/morning_checkins');
    return { saved: false, duplicate: false };
  }
}

interface Stretch {
  id: string;
  title: string;
  description: string;
  duration: number; // seconds
  image: string;
  targetArea: string;
}

const STRETCHES: Stretch[] = [
  {
    id: '1',
    title: 'Elongación Cervical',
    description: 'Inclina suavemente la cabeza hacia un lado, llevando la oreja al hombro. Mantén la espalda recta.',
    duration: 15,
    image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&q=80&w=200&h=200',
    targetArea: 'Cuello'
  },
  {
    id: '2',
    title: 'Apertura de Pecho',
    description: 'Entrelaza las manos detrás de la espalda y estira los brazos hacia atrás, abriendo el pecho.',
    duration: 20,
    image: 'https://images.unsplash.com/photo-1510894347713-fc3ad6cb0d4d?auto=format&fit=crop&q=80&w=200&h=200',
    targetArea: 'Torso'
  },
  {
    id: '3',
    title: 'Estiramiento Lumbar',
    description: 'De pie, inclina el torso hacia adelante suavemente, intentando tocar la punta de los pies.',
    duration: 20,
    image: 'https://images.unsplash.com/photo-1552196564-977a44c0d3b9?auto=format&fit=crop&q=80&w=200&h=200',
    targetArea: 'Espalda'
  },
  {
    id: '4',
    title: 'Activación de Muñecas',
    description: 'Extiende un brazo y con la otra mano tira suavemente de los dedos hacia atrás.',
    duration: 15,
    image: 'https://images.unsplash.com/photo-1591343395082-e120087004b4?auto=format&fit=crop&q=80&w=200&h=200',
    targetArea: 'Brazos'
  }
];

interface CapsuleResp {
  title: string;
  body: string;
  durationSeconds: number;
  sourceNodes: string[];
  xpReward: number;
}

export function MorningRoutine() {
  const [step, setStep] = useState<'intro' | 'active' | 'complete'>('intro');
  const [currentStretchIndex, setCurrentStretchIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [alreadyCompletedToday, setAlreadyCompletedToday] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);

  // Sprint 16 — Cápsula de Sabiduría slot.
  const { selectedProject } = useProject();
  const [capsule, setCapsule] = useState<CapsuleResp | null>(null);
  const [capsuleLoading, setCapsuleLoading] = useState(false);
  const [capsuleAcked, setCapsuleAcked] = useState(false);
  const [capsuleAckXp, setCapsuleAckXp] = useState<number | null>(null);

  // Sprint 25 SS.3 — duplicate-prevention probe.
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const ref = doc(db, 'users', uid, 'morning_checkins', todayLocalISO());
        const snap = await getDoc(ref);
        if (!cancelled && snap.exists()) {
          setAlreadyCompletedToday(true);
        }
      } catch {
        // silent — feature degrades to "allow attempt" if probe fails
      }
    }
    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selectedProject?.id) return;
      setCapsuleLoading(true);
      try {
        // §2.20 (2026-05-23) — apiAuthHeader unified.
        const authHeader = await apiAuthHeader();
        if (!authHeader) return;
        const today = new Date().toISOString().slice(0, 10);
        const res = await fetch(
          `/api/wisdom-capsule/today?projectId=${encodeURIComponent(selectedProject.id)}&date=${today}`,
          { headers: { ...(authHeader ? { 'Authorization': authHeader } : {}) } }
        );
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setCapsule(j.capsule ?? null);
      } catch {
        // silent — slot degrades gracefully when network/Firestore unavailable
      } finally {
        if (!cancelled) setCapsuleLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id]);

  const ackCapsule = async () => {
    if (!selectedProject?.id || capsuleAcked) return;
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      if (!authHeader) return;
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/wisdom-capsule/ack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({ projectId: selectedProject.id, date: today }),
      });
      if (res.ok) {
        const j = await res.json();
        setCapsuleAcked(true);
        setCapsuleAckXp(j.xpAwarded ?? 0);
      }
    } catch {
      // best-effort
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isActive && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isActive) {
      if (currentStretchIndex < STRETCHES.length - 1) {
        setCurrentStretchIndex((prev) => prev + 1);
        setTimeLeft(STRETCHES[currentStretchIndex + 1].duration);
      } else {
        setIsActive(false);
        setStep('complete');
        // SS.3 — fire-and-forget persistence + XP. Errors surface inline
        // but never block the UX (matches MorningCheckIn convention).
        const uid = auth.currentUser?.uid;
        if (uid && !alreadyCompletedToday) {
          void (async () => {
            const result = await persistMorningCheckIn(uid, {
              date: todayLocalISO(),
            });
            if (result.duplicate) {
              setAlreadyCompletedToday(true);
              return;
            }
            if (result.saved) {
              try {
                await awardPoints('morning_checkin');
              } catch {
                // gamification endpoint is best-effort
              }
            } else {
              setPersistError('No se pudo guardar el check-in.');
            }
          })();
        }
      }
    }
    return () => clearInterval(timer);
  }, [isActive, timeLeft, currentStretchIndex, alreadyCompletedToday]);

  const startRoutine = () => {
    setStep('active');
    setCurrentStretchIndex(0);
    setTimeLeft(STRETCHES[0].duration);
    setIsActive(true);
  };

  const currentStretch = STRETCHES[currentStretchIndex];

  return (
    <Card className="p-6 border-white/5 overflow-hidden relative">
      <AnimatePresence mode="wait">
        {step === 'intro' && (
          <motion.div
            key="intro"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-amber-500/20 border border-amber-500/30">
                <Sun className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Despertar Matutino</h3>
                <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Protocolo de Activación Física</p>
              </div>
            </div>

            <p className="text-sm text-zinc-400 leading-relaxed">
              Prepara tu cuerpo para la jornada. Estas elongaciones reducen el riesgo de lesiones musculoesqueléticas y mejoran tu enfoque.
            </p>

            {/* Sprint 16 — Cápsula de Sabiduría slot */}
            {(capsule || capsuleLoading) && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-amber-400" />
                  <h4 className="text-[11px] font-black text-amber-400 uppercase tracking-widest">
                    Cápsula de Sabiduría
                  </h4>
                </div>
                {capsuleLoading && !capsule && (
                  <p className="text-xs text-zinc-400">Cargando cápsula…</p>
                )}
                {capsule && (
                  <>
                    <div>
                      <p className="text-sm font-bold text-white mb-1">{capsule.title}</p>
                      <p className="text-xs text-zinc-300 leading-relaxed">{capsule.body}</p>
                    </div>
                    <button
                      onClick={ackCapsule}
                      disabled={capsuleAcked}
                      className={`w-full py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                        capsuleAcked
                          ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                          : 'bg-amber-500 hover:bg-amber-600 text-zinc-950'
                      }`}
                    >
                      {capsuleAcked ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Entendido {capsuleAckXp ? `+${capsuleAckXp} XP` : ''}
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Marcar entendido
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}
            {/* Random motivational quote keeps the existing widget contract */}
            {!selectedProject?.id && (
              <WisdomCapsule />
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <Timer className="w-4 h-4 text-amber-400 mb-2" />
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Duración</p>
                <p className="text-sm font-bold text-white">~2 Minutos</p>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <Activity className="w-4 h-4 text-emerald-400 mb-2" />
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Intensidad</p>
                <p className="text-sm font-bold text-white">Baja / Activación</p>
              </div>
            </div>

            {alreadyCompletedToday ? (
              <div
                data-testid="morning-routine-duplicate"
                className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3"
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <p className="text-xs text-emerald-300 font-bold uppercase tracking-wider">
                  Ya completaste tu check-in hoy. Nos vemos mañana.
                </p>
              </div>
            ) : (
              <button
                onClick={startRoutine}
                className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              >
                Iniciar Check-in Fisiológico
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {persistError && (
              <p
                data-testid="morning-routine-error"
                className="text-xs text-rose-400 text-center"
              >
                {persistError}
              </p>
            )}
          </motion.div>
        )}

        {step === 'active' && (
          <motion.div
            key="active"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="space-y-6"
          >
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                Ejercicio {currentStretchIndex + 1} de {STRETCHES.length}
              </span>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                <Timer className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-mono font-bold text-white">{timeLeft}s</span>
              </div>
            </div>

            <div className="relative aspect-square rounded-3xl overflow-hidden border border-white/10">
              <img 
                src={currentStretch.image} 
                alt={currentStretch.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-6">
                <h4 className="text-xl font-black text-white mb-1">{currentStretch.title}</h4>
                <p className="text-xs text-zinc-300 leading-relaxed">{currentStretch.description}</p>
              </div>
            </div>

            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-amber-500"
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: currentStretch.duration, ease: 'linear' }}
                key={currentStretch.id}
              />
            </div>

            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase">
              <Heart className="w-3 h-3 text-rose-500" />
              Zona: {currentStretch.targetArea}
            </div>
          </motion.div>
        )}

        {step === 'complete' && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-6 py-4"
          >
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto relative">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <motion.div 
                className="absolute inset-0 rounded-full border-2 border-emerald-500"
                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>

            <div>
              <h3 className="text-2xl font-black text-white mb-2">¡Cuerpo Sincronizado!</h3>
              <p className="text-sm text-zinc-400">
                Has completado tu activación matutina. Estás listo para operar con seguridad.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-left">
              <Shield className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-400 font-bold">
                Puntos de Seguridad obtenidos: +15 XP
              </p>
            </div>

            <button
              onClick={() => setStep('intro')}
              className="w-full py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-black text-xs uppercase tracking-widest transition-all"
            >
              Finalizar Check-in
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
