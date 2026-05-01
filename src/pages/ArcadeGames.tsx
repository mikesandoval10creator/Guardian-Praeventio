// Round 15 / I4 — Arcade hub.
//
// Propósito: agrupar los serious-games de Praeventio bajo un hub navegable.
// Cada juego declara metadata (objetivo de aprendizaje, normativa cubierta,
// tier requerido) en GAMES_REGISTRY. La lista renderiza tarjetas y enlaza a
// la ruta del juego.
//
// Tier: canUseAdvancedAnalytics (Diamante+) — el hub completo es premium.
// Los juegos individuales también tienen su propio guard, así que un usuario
// que llegue por deep-link igual queda gateado.

import React from 'react';
import { Link } from 'react-router-dom';
import { Gamepad2, Wrench, Route, Brain, Target, ShieldAlert, Zap } from 'lucide-react';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { Card } from '../components/shared/Card';

interface GameMeta {
  id: string;
  title: string;
  path: string;
  objective: string;
  normativa: string;
  tier: 'Diamante+';
  Icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

export const GAMES_REGISTRY: GameMeta[] = [
  {
    id: 'clawmachine',
    title: 'Drill de EPP',
    path: '/clawmachine',
    objective: 'Selección rápida del EPP correcto frente a escenarios aleatorios.',
    normativa: 'DS 594 · Ley 16.744',
    tier: 'Diamante+',
    Icon: Wrench,
    accent: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20',
  },
  {
    id: 'poolgame',
    title: 'Drill de Evacuación',
    path: '/poolgame',
    objective: 'Calcula rutas óptimas de evacuación en planos 2D bajo presión de tiempo.',
    normativa: 'DS 594 · NCh 2189',
    tier: 'Diamante+',
    Icon: Route,
    accent: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  },
  {
    id: 'reflex',
    title: 'Reflex Buzzer',
    path: '/training',
    objective: 'Entrena el tiempo de reacción frente a alarmas y señales acústicas.',
    normativa: 'NCh 1410 · Señalización',
    tier: 'Diamante+',
    Icon: Zap,
    accent: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  {
    id: 'find-guardian',
    title: 'Find the Guardian',
    path: '/training',
    objective: 'Identifica condiciones inseguras en escenas fotográficas.',
    normativa: 'DS 594 · Inspección',
    tier: 'Diamante+',
    Icon: Target,
    accent: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  },
  {
    id: 'normative-quiz',
    title: 'Quiz de Normativa',
    path: '/training',
    objective: 'Memoriza artículos clave de Ley 16.744 y DS 594.',
    normativa: 'Ley 16.744',
    tier: 'Diamante+',
    Icon: Brain,
    accent: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  },
];

export function ArcadeGames() {
  return (
    <PremiumFeatureGuard
      featureName="Arcade de Seguridad (Diamante+)"
      feature="canUseAdvancedAnalytics"
      description="Hub de serious-games que entrenan respuesta a incidentes, evacuación y memoria normativa."
    >
      <ArcadeGamesInner />
    </PremiumFeatureGuard>
  );
}

function ArcadeGamesInner() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <Gamepad2 className="w-8 h-8 text-fuchsia-500" />
            Arcade de Seguridad
          </h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em] mt-2">
            Serious-Games Tier-Gated · Refuerzo Conductual
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> {GAMES_REGISTRY.length} juegos disponibles
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {GAMES_REGISTRY.map(game => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>

      <Card className="p-6 border-white/5 space-y-2">
        <h2 className="text-sm font-black text-zinc-300 uppercase tracking-widest">
          Por qué jugar
        </h2>
        <p className="text-sm text-zinc-400 leading-relaxed">
          Los serious-games refuerzan respuestas automáticas (memoria muscular) y reducen el
          tiempo de reacción frente a incidentes reales. Cada partida persiste un puntaje a tu
          historial gamificado y se registra en el audit log para evidencia de capacitación
          continua (Ley 16.744 Art. 21, DS 40 Art. 3).
        </p>
      </Card>
    </div>
  );
}

function GameCard({ game }: { game: GameMeta }) {
  const { Icon, accent, path, title, objective, normativa, tier } = game;
  return (
    <Link to={path} aria-label={`Jugar ${title}`}>
      <Card className="p-5 border-white/5 h-full transition-transform hover:-translate-y-0.5 hover:border-zinc-700">
        <div className="flex items-start justify-between mb-3">
          <div className={`p-2 rounded-xl border ${accent}`}>
            <Icon className="w-5 h-5" />
          </div>
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
            {tier}
          </span>
        </div>
        <h3 className="text-base font-bold text-white mb-1">{title}</h3>
        <p className="text-xs text-zinc-400 leading-relaxed mb-3">{objective}</p>
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{normativa}</p>
      </Card>
    </Link>
  );
}

export default ArcadeGames;
