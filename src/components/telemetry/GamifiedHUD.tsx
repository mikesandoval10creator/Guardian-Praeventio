import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Wind, HeartPulse } from 'lucide-react';

export interface StatusEffect {
  id: string;
  name: string;
  type: 'buff' | 'debuff';
  duration: number; // in seconds
  icon: React.ReactNode;
}

interface GamifiedHUDProps {
  health: number;
  toxin: number;
  effects: StatusEffect[];
  onSimulateGasLeak: () => void;
  onHeal: () => void;
}

/**
 * Visual HUD showing the gamified vitals (HP / CO exposure)
 * and active status effects, plus the demo simulation controls
 * ("Simular Fuga CO" / "Curar"). Extracted from Telemetry.tsx.
 */
export function GamifiedHUD({ health, toxin, effects, onSimulateGasLeak, onHeal }: GamifiedHUDProps) {
  return (
    <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-10">
        <Activity className="w-32 h-32 text-emerald-500" />
      </div>

      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Vitals */}
        <div className="space-y-6">
          <div>
            <div className="flex justify-between items-end mb-2">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-emerald-500" />
                <span className="text-xs font-black text-zinc-400 uppercase tracking-widest">Integridad (HP)</span>
              </div>
              <span className="text-2xl font-black text-white">{health}%</span>
            </div>
            <div className="h-4 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
              <motion.div
                className="h-full bg-emerald-500"
                initial={{ width: 0 }}
                animate={{ width: `${health}%` }}
                transition={{ type: 'spring', bounce: 0.4 }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-end mb-2">
              <div className="flex items-center gap-2">
                <Wind className="w-5 h-5 text-purple-500" />
                <span className="text-xs font-black text-zinc-400 uppercase tracking-widest">Exposición a Gases (CO)</span>
              </div>
              <span className="text-2xl font-black text-white">{toxin}%</span>
            </div>
            <div className="h-4 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
              <motion.div
                className="h-full bg-purple-500"
                initial={{ width: 0 }}
                animate={{ width: `${toxin}%` }}
                transition={{ type: 'spring', bounce: 0.4 }}
              />
            </div>
          </div>
        </div>

        {/* Status Effects */}
        <div className="border-t md:border-t-0 md:border-l border-zinc-800 pt-6 md:pt-0 md:pl-8">
          <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4">Efectos de Estado</h3>
          <div className="flex flex-wrap gap-3">
            <AnimatePresence>
              {effects.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="text-sm text-zinc-600 font-mono"
                >
                  Sin efectos activos.
                </motion.div>
              ) : (
                effects.map(effect => (
                  <motion.div
                    key={effect.id}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                      effect.type === 'buff'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                    }`}
                  >
                    {effect.icon}
                    <span className="text-xs font-bold uppercase tracking-wider">{effect.name}</span>
                    <span className="text-[10px] font-mono opacity-70 ml-1">{effect.duration}s</span>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>

          {/* Simulation Controls (For Demo) */}
          <div className="mt-6 flex gap-2">
            <button
              onClick={onSimulateGasLeak}
              className="px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors"
            >
              Simular Fuga CO
            </button>
            <button
              onClick={onHeal}
              className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors"
            >
              Curar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
