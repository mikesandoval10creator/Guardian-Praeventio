import React from 'react';
import { WisdomCapsule } from './WisdomCapsule';

export function ConsciousnessLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="flex flex-col items-center mb-12">
        <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Calibrando Conciencia...
        </span>
      </div>
      <WisdomCapsule />
    </div>
  );
}
