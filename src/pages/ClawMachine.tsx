// Round 15 / I4 — Drill gamificado de respuesta a incidentes (DS 594, Ley 16.744).
// Reframe "claw machine": selección rápida del EPP correcto para un escenario
// aleatorio (derrame químico, eléctrico, altura, fuego). Entrena la respuesta
// automática ("muscle memory") bajo presión de tiempo.
// Persistencia: gamification_scores/{userId}_clawmachine (schema en gameScore.ts).
// Audit: gamification.drill.completed. Tier: canUseAdvancedAnalytics.
// R16 follow-up: append-only firestore.rules para gamification_scores.

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Wrench, Shield, AlertTriangle, CheckCircle2, Loader2, Trophy, Clock } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { Card, Button } from '../components/shared/Card';
import { logAuditAction } from '../services/auditService';
import { mergeScoreDoc, gameScoreDocId, type GameScoreDoc } from '../components/games/gameScore';

interface Scenario {
  id: string;
  title: string;
  description: string;
  required: string[]; // EPP correctos
  decoys: string[]; // EPP incorrectos
}

const SCENARIOS: Scenario[] = [
  {
    id: 'chem-spill',
    title: 'Derrame químico (ácido sulfúrico)',
    description: 'Bodega de químicos. Pictograma GHS05 corrosivo. Charco activo.',
    required: ['Respirador full-face', 'Traje Tyvek', 'Guantes nitrilo', 'Botas PVC'],
    decoys: ['Guantes dieléctricos', 'Casco aluminizado', 'Arnés clase E'],
  },
  {
    id: 'electric',
    title: 'Contacto eléctrico (tablero 380V)',
    description: 'Mantenimiento de tablero energizado. Riesgo de arco eléctrico.',
    required: ['Guantes dieléctricos', 'Casco clase E', 'Lentes arco', 'Botas dieléctricas'],
    decoys: ['Respirador full-face', 'Traje Tyvek', 'Guantes nitrilo'],
  },
  {
    id: 'fall',
    title: 'Trabajo en altura (>1.8 m)',
    description: 'Andamio a 4 m sobre nivel de piso. Sin baranda perimetral.',
    required: ['Arnés cuerpo completo', 'Línea de vida', 'Casco con barbiquejo', 'Calzado antideslizante'],
    decoys: ['Guantes nitrilo', 'Respirador full-face', 'Botas dieléctricas'],
  },
  {
    id: 'fire',
    title: 'Amago de incendio (clase B)',
    description: 'Bodega de combustibles. Llama controlada en derrame.',
    required: ['Casco aluminizado', 'Traje proximidad', 'Extintor PQS', 'Guantes ignífugos'],
    decoys: ['Arnés clase E', 'Respirador full-face', 'Lentes arco'],
  },
];

const ROUND_SECONDS = 20;

function pickRandomScenario(prev?: string): Scenario {
  const pool = prev ? SCENARIOS.filter(s => s.id !== prev) : SCENARIOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function ClawMachine() {
  return (
    <PremiumFeatureGuard
      featureName="Drill de Respuesta (Diamante+)"
      feature="canUseAdvancedAnalytics"
      description="Entrena la selección automática de EPP frente a escenarios reales de DS 594 / Ley 16.744."
    >
      <ClawMachineInner />
    </PremiumFeatureGuard>
  );
}

function ClawMachineInner() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [scenario, setScenario] = useState<Scenario>(() => pickRandomScenario());
  const [picked, setPicked] = useState<string[]>([]);
  const [seconds, setSeconds] = useState(ROUND_SECONDS);
  const [phase, setPhase] = useState<'playing' | 'review' | 'saving' | 'saved'>('playing');
  const [score, setScore] = useState(0);
  const [savedDoc, setSavedDoc] = useState<GameScoreDoc | null>(null);

  const allOptions = useMemo(() => {
    const pool = [...scenario.required, ...scenario.decoys];
    // Stable shuffle per scenario id so RTL tests can pick deterministically.
    return pool.sort((a, b) => (a + scenario.id).localeCompare(b + scenario.id));
  }, [scenario]);

  useEffect(() => {
    if (phase !== 'playing') return;
    if (seconds <= 0) { setPhase('review'); return; }
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, phase]);

  const togglePick = (opt: string) => {
    if (phase !== 'playing') return;
    setPicked(prev => prev.includes(opt) ? prev.filter(p => p !== opt) : [...prev, opt]);
  };

  const finish = () => {
    const correct = scenario.required.filter(r => picked.includes(r)).length;
    const wrong = picked.filter(p => !scenario.required.includes(p)).length;
    const missed = scenario.required.length - correct;
    const roundScore = Math.max(0, correct * 25 - wrong * 15 - missed * 10);
    setScore(prev => prev + roundScore);
    setPhase('review');
  };

  const next = () => {
    setScenario(prev => pickRandomScenario(prev.id));
    setPicked([]);
    setSeconds(ROUND_SECONDS);
    setPhase('playing');
  };

  const persist = async () => {
    if (!user) { setPhase('saved'); return; }
    setPhase('saving');
    try {
      const ref = doc(db, 'gamification_scores', gameScoreDocId(user.uid, 'clawmachine'));
      const snap = await getDoc(ref);
      const merged = mergeScoreDoc({
        newScore: score,
        existing: snap.exists() ? (snap.data() as Partial<GameScoreDoc>) : null,
        userId: user.uid,
        gameId: 'clawmachine',
        updatedBy: user.displayName || user.email || user.uid,
      });
      await setDoc(ref, merged);
      setSavedDoc(merged);
      await logAuditAction(
        'gamification.drill.completed',
        'gamification',
        { gameId: 'clawmachine', score, scenarioId: scenario.id },
        selectedProject?.id,
      );
      setPhase('saved');
    } catch (err) {
      console.error('ClawMachine persist failed', err);
      setPhase('saved');
    }
  };

  const correct = scenario.required.filter(r => picked.includes(r));
  const wrong = picked.filter(p => !scenario.required.includes(p));
  const missed = scenario.required.filter(r => !picked.includes(r));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <Wrench className="w-7 h-7 text-fuchsia-500" /> Drill de Respuesta — EPP
          </h1>
          <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">DS 594 · Ley 16.744</p>
        </div>
        <div className="px-4 py-2 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400 font-bold flex items-center gap-2">
          <Trophy className="w-4 h-4" /> {score} pts
        </div>
      </div>

      <Card className="p-6 space-y-4 border-white/5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{scenario.title}</h2>
          <div className={`flex items-center gap-2 font-bold ${seconds <= 5 ? 'text-rose-400' : 'text-zinc-300'}`}>
            <Clock className="w-4 h-4" /> {seconds}s
          </div>
        </div>
        <p className="text-sm text-zinc-400">{scenario.description}</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {allOptions.map(opt => {
            const sel = picked.includes(opt);
            const reviewing = phase === 'review' || phase === 'saving' || phase === 'saved';
            const isReq = scenario.required.includes(opt);
            const cls = !reviewing
              ? sel ? 'border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-300' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
              : isReq
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : sel ? 'border-rose-500 bg-rose-500/10 text-rose-300' : 'border-zinc-800 text-zinc-600';
            return (
              <button key={opt} onClick={() => togglePick(opt)} disabled={reviewing}
                className={`p-3 rounded-xl border text-xs font-medium transition-all flex items-center gap-2 ${cls}`}>
                <Shield className="w-3.5 h-3.5" /> {opt}
              </button>
            );
          })}
        </div>

        {phase === 'playing' && (
          <Button onClick={finish} className="w-full">Confirmar selección</Button>
        )}

        {(phase === 'review' || phase === 'saving' || phase === 'saved') && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="Correctos" value={correct.length} cls="text-emerald-400" />
              <Stat label="Incorrectos" value={wrong.length} cls="text-rose-400" />
              <Stat label="Faltantes" value={missed.length} cls="text-amber-400" />
            </div>
            {missed.length > 0 && (
              <div className="text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
                Faltó: {missed.join(', ')}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="secondary" onClick={next}>Siguiente escenario</Button>
              <Button onClick={persist} disabled={phase !== 'review'}>
                {phase === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Guardando…</> :
                 phase === 'saved' ? <><CheckCircle2 className="w-4 h-4 mr-2" />Guardado</> :
                 'Guardar puntaje'}
              </Button>
            </div>
            {savedDoc && (
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">
                Mejor puntaje: {savedDoc.bestScore} · partidas: {savedDoc.plays}
              </p>
            )}
          </motion.div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="p-3 rounded-xl bg-zinc-900 border border-white/5 text-center">
      <p className={`text-2xl font-black ${cls}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</p>
    </div>
  );
}
export default ClawMachine;
