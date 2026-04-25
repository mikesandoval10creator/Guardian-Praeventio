import React from 'react';
import { motion } from 'framer-motion';
import { Brain, Mic, MicOff, RotateCcw, Coffee } from 'lucide-react';
import { useSensoryFatigue } from '../../hooks/useSensoryFatigue';

export function SensoryFatigueMonitor() {
  const { fatigueIndex, shouldRest, noiseLevel, isListening, startListening, stopListening, reset } =
    useSensoryFatigue();

  const color =
    fatigueIndex >= 75 ? 'rose' :
    fatigueIndex >= 50 ? 'amber' : 'emerald';

  const colorMap = {
    rose:    { bar: 'bg-rose-500',   text: 'text-rose-400',   badge: 'bg-rose-500/20 border-rose-500/30 text-rose-400' },
    amber:   { bar: 'bg-amber-500',  text: 'text-amber-400',  badge: 'bg-amber-500/20 border-amber-500/30 text-amber-400' },
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' },
  };
  const c = colorMap[color];

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/10 rounded-xl">
            <Brain className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-widest">Carga Sensorial</h3>
            <p className="text-[10px] text-zinc-500">Exposición acústica acumulada</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Reiniciar"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={isListening ? stopListening : startListening}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${
              isListening
                ? 'bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:bg-rose-500/30'
                : 'bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            {isListening ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
            {isListening ? 'Midiendo' : 'Iniciar'}
          </button>
        </div>
      </div>

      {/* Gauge */}
      <div className="space-y-2">
        <div className="flex justify-between items-end">
          <span className={`text-3xl font-black ${c.text}`}>{fatigueIndex}</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">/ 100</span>
        </div>
        <div className="h-3 w-full bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${c.bar}`}
            initial={{ width: 0 }}
            animate={{ width: `${fatigueIndex}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        <div className="flex justify-between text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
          <span>Bajo</span>
          <span>Moderado</span>
          <span>Crítico</span>
        </div>
      </div>

      {/* Live noise level */}
      {isListening && (
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/60 rounded-xl border border-white/5">
          <motion.div
            className={`w-2 h-2 rounded-full ${c.bar}`}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ repeat: Infinity, duration: 1 }}
          />
          <span className="text-xs text-zinc-400">
            Nivel actual: <span className={`font-black ${c.text}`}>{Math.round(noiseLevel)} dB</span>
          </span>
        </div>
      )}

      {/* Rest alert */}
      {shouldRest && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl"
        >
          <Coffee className="w-5 h-5 text-rose-400 shrink-0" />
          <div>
            <p className="text-xs font-black text-rose-400 uppercase tracking-widest">Pausa Recomendada</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">
              Exposición acústica elevada sostenida. Retírate a un área tranquila por 10–15 min.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
