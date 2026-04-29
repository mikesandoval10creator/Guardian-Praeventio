// Round 15 / I4 — Drill de evacuación física.
//
// Propósito de seguridad: reframe del clásico "billar / pool" como un
// mini-juego de cálculo de ángulos de evacuación. El jugador debe trazar la
// ruta de un trabajador (cue ball) a la salida (poket) en una planta 2D
// simulando un evento de emergencia (DS 594, NCh 2189). El cálculo del ángulo
// y la distancia entrena la rapidez de toma de decisiones.
//
// - Persistencia: gamification_scores/{userId}_poolgame con bestTimeSeconds.
// - Audit log: gamification.evacuation_drill.completed.
// - Tier: canUseAdvancedAnalytics (Diamante+).
//
// Nota R16: la vista 2D es deliberadamente simple — un canvas con obstáculos
// rectangulares y un puerto de salida. Una versión más rica (planos importados,
// mapas reales) queda como follow-up.

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Route, Loader2, CheckCircle2, Clock, Trophy, Target } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { Card, Button } from '../components/shared/Card';
import { logAuditAction } from '../services/auditService';
import { mergeScoreDoc, gameScoreDocId, type GameScoreDoc } from '../components/games/gameScore';

// 2D map: width/height units, obstacles, start, exit.
interface MapDef {
  w: number;
  h: number;
  obstacles: { x: number; y: number; w: number; h: number }[];
  start: { x: number; y: number };
  exit: { x: number; y: number; r: number };
}

const MAP: MapDef = {
  w: 600, h: 360,
  obstacles: [
    { x: 120, y: 80, w: 90, h: 30 }, // mesa
    { x: 280, y: 180, w: 140, h: 40 }, // hall
    { x: 460, y: 60, w: 30, h: 200 }, // muro lateral
  ],
  start: { x: 60, y: 300 },
  exit: { x: 540, y: 60, r: 24 },
};

/** Pure helper — returns true if a straight line segment from a to b
 *  intersects ANY of the rectangular obstacles. Used for path validation
 *  and unit-tested separately if needed (kept local to keep page < 250 LOC). */
export function segmentIntersectsObstacles(
  a: { x: number; y: number },
  b: { x: number; y: number },
  obstacles: MapDef['obstacles'],
): boolean {
  // Sample N points along the segment; if any falls inside an obstacle, fail.
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    for (const o of obstacles) {
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return true;
    }
  }
  return false;
}

export function PoolGame() {
  return (
    <PremiumFeatureGuard
      featureName="Drill de Evacuación (Diamante+)"
      feature="canUseAdvancedAnalytics"
      description="Calcula rutas de evacuación seguras en planos 2D y entrena la respuesta ante emergencia."
    >
      <PoolGameInner />
    </PremiumFeatureGuard>
  );
}

function PoolGameInner() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waypoints, setWaypoints] = useState<{ x: number; y: number }[]>([]);
  const [startTs, setStartTs] = useState<number | null>(null);
  const [phase, setPhase] = useState<'planning' | 'verified' | 'saving' | 'saved'>('planning');
  const [verdict, setVerdict] = useState<{ ok: boolean; distance: number; seconds: number } | null>(null);
  const [savedDoc, setSavedDoc] = useState<GameScoreDoc | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    // Background
    ctx.fillStyle = '#09090b'; ctx.fillRect(0, 0, c.width, c.height);
    // Obstacles
    ctx.fillStyle = '#3f3f46';
    for (const o of MAP.obstacles) ctx.fillRect(o.x, o.y, o.w, o.h);
    // Start (worker)
    ctx.fillStyle = '#10b981'; ctx.beginPath();
    ctx.arc(MAP.start.x, MAP.start.y, 10, 0, Math.PI * 2); ctx.fill();
    // Exit
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(MAP.exit.x, MAP.exit.y, MAP.exit.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 10px sans-serif';
    ctx.fillText('SALIDA', MAP.exit.x - 22, MAP.exit.y + 3);
    // Path
    if (waypoints.length > 0) {
      ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(MAP.start.x, MAP.start.y);
      for (const p of waypoints) ctx.lineTo(p.x, p.y);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#a78bfa';
      for (const p of waypoints) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); }
    }
  }, [waypoints]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phase !== 'planning') return;
    const c = canvasRef.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * c.width;
    const y = ((e.clientY - rect.top) / rect.height) * c.height;
    if (waypoints.length === 0 && startTs === null) setStartTs(Date.now());
    setWaypoints(prev => [...prev, { x, y }]);
  };

  const verify = () => {
    if (waypoints.length === 0) return;
    const seconds = startTs ? (Date.now() - startTs) / 1000 : 0;
    let prev = MAP.start;
    let distance = 0;
    let ok = true;
    for (const wp of waypoints) {
      if (segmentIntersectsObstacles(prev, wp, MAP.obstacles)) { ok = false; break; }
      distance += Math.hypot(wp.x - prev.x, wp.y - prev.y);
      prev = wp;
    }
    if (ok) {
      const last = waypoints[waypoints.length - 1];
      const distToExit = Math.hypot(last.x - MAP.exit.x, last.y - MAP.exit.y);
      if (distToExit > MAP.exit.r) ok = false;
    }
    setVerdict({ ok, distance: Math.round(distance), seconds: Math.round(seconds * 10) / 10 });
    setPhase('verified');
  };

  const reset = () => {
    setWaypoints([]); setStartTs(null); setVerdict(null); setPhase('planning');
  };

  const persist = async () => {
    if (!user || !verdict || !verdict.ok) { setPhase('saved'); return; }
    setPhase('saving');
    const score = Math.max(0, 1000 - Math.round(verdict.distance) - Math.round(verdict.seconds * 5));
    try {
      const ref = doc(db, 'gamification_scores', gameScoreDocId(user.uid, 'poolgame'));
      const snap = await getDoc(ref);
      const merged = mergeScoreDoc({
        newScore: score,
        newTimeSeconds: verdict.seconds,
        existing: snap.exists() ? (snap.data() as Partial<GameScoreDoc>) : null,
        userId: user.uid,
        gameId: 'poolgame',
        updatedBy: user.displayName || user.email || user.uid,
      });
      await setDoc(ref, merged);
      setSavedDoc(merged);
      await logAuditAction(
        'gamification.evacuation_drill.completed',
        'gamification',
        { gameId: 'poolgame', score, distance: verdict.distance, seconds: verdict.seconds },
        selectedProject?.id,
      );
      setPhase('saved');
    } catch (err) {
      console.error('PoolGame persist failed', err);
      setPhase('saved');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <Route className="w-7 h-7 text-violet-400" /> Drill de Evacuación
          </h1>
          <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">DS 594 · NCh 2189</p>
        </div>
        {savedDoc && (
          <div className="px-4 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 font-bold flex items-center gap-2">
            <Trophy className="w-4 h-4" /> Mejor: {savedDoc.bestScore}
          </div>
        )}
      </div>

      <Card className="p-6 space-y-4 border-white/5">
        <p className="text-sm text-zinc-400">
          Haz click en el plano para marcar waypoints desde el trabajador <span className="text-emerald-400">●</span>
          {' '}hasta la salida <span className="text-amber-400">○</span>. Evita los obstáculos (gris).
        </p>
        <canvas
          ref={canvasRef}
          width={MAP.w}
          height={MAP.h}
          onClick={handleCanvasClick}
          aria-label="Plano de evacuación interactivo"
          className="w-full max-w-full bg-zinc-950 border border-white/10 rounded-xl cursor-crosshair"
          style={{ aspectRatio: `${MAP.w}/${MAP.h}` }}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={verify} disabled={waypoints.length === 0 || phase !== 'planning'}>
            <Target className="w-4 h-4 mr-2" /> Verificar ruta
          </Button>
          <Button variant="secondary" onClick={reset}>Reiniciar</Button>
          {verdict?.ok && (
            <Button onClick={persist} disabled={phase === 'saving' || phase === 'saved'}>
              {phase === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Guardando…</> :
               phase === 'saved' ? <><CheckCircle2 className="w-4 h-4 mr-2" />Guardado</> :
               'Guardar tiempo'}
            </Button>
          )}
        </div>
        {verdict && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-xl border text-sm ${verdict.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
            {verdict.ok ? (
              <div className="flex flex-wrap items-center gap-4">
                <span className="font-bold flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Ruta válida</span>
                <span className="text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> {verdict.seconds}s</span>
                <span className="text-xs">Distancia: {verdict.distance}u</span>
              </div>
            ) : (
              <span>Ruta bloqueada — la trayectoria cruza un obstáculo o no termina en la salida.</span>
            )}
          </motion.div>
        )}
      </Card>
    </div>
  );
}

export default PoolGame;
