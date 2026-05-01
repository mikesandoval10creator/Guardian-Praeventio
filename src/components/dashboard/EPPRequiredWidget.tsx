// Praeventio Guard — EPP requirement banner extracted from Dashboard.tsx (A11 R18).
// Static (no props); kept separate so Dashboard.tsx stays slim.

import { Shield } from 'lucide-react';

export function EPPRequiredWidget() {
  return (
    <section className="w-full mt-1 sm:mt-0">
      <div className="bg-[#4ADE80] dark:bg-emerald-900/40 p-1.5 sm:p-4 rounded-xl sm:rounded-2xl shadow-sm relative border border-white/20 dark:border-emerald-500/20 w-full flex flex-col justify-center items-center">
        <div className="absolute -top-2 bg-[#22C55E] dark:bg-emerald-600 text-white px-1.5 py-0.5 rounded-full text-[8px] sm:text-xs font-black uppercase tracking-widest shadow-sm flex items-center gap-1 border border-white/20 dark:border-emerald-500/30 whitespace-nowrap z-10">
          EPP Requerido
        </div>

        <div className="flex items-center justify-center gap-1 sm:gap-4 w-full flex-1 mt-1.5 sm:mt-3">
          <div className="flex gap-1 sm:gap-3">
            <div className="bg-white dark:bg-zinc-900/80 p-1 sm:p-3 rounded-lg sm:rounded-xl shadow-sm text-center w-8 sm:w-16 border border-transparent dark:border-white/5 transition-all">
              <div className="text-sm sm:text-2xl leading-none mb-0.5">👷</div>
              <div className="bg-black dark:bg-zinc-800 text-white text-[6px] sm:text-[10px] font-black py-0.5 rounded-sm uppercase leading-tight">Casco</div>
            </div>
            <div className="bg-white dark:bg-zinc-900/80 p-1 sm:p-3 rounded-lg sm:rounded-xl shadow-sm text-center w-8 sm:w-16 border border-transparent dark:border-white/5 transition-all">
              <div className="text-sm sm:text-2xl leading-none mb-0.5">🧤</div>
              <div className="bg-black dark:bg-zinc-800 text-white text-[6px] sm:text-[10px] font-black py-0.5 rounded-sm uppercase leading-tight">Guantes</div>
            </div>
          </div>

          <div className="bg-white/40 dark:bg-black/20 backdrop-blur-sm rounded-xl sm:rounded-2xl p-1 sm:p-3 shadow-inner w-8 h-8 sm:w-16 sm:h-16 flex flex-col items-center justify-center border border-dashed border-white/60 dark:border-white/10 shrink-0">
            <Shield className="w-3 h-3 sm:w-6 sm:h-6 text-emerald-800/40 dark:text-emerald-500/40 mb-0.5" />
            <span className="text-emerald-800/40 dark:text-emerald-500/40 text-[4px] sm:text-[8px] font-black uppercase tracking-widest text-center px-0.5 leading-tight">Praeventio</span>
          </div>

          <div className="flex gap-1 sm:gap-3">
            <div className="bg-white dark:bg-zinc-900/80 p-1 sm:p-3 rounded-lg sm:rounded-xl shadow-sm text-center w-8 sm:w-16 border border-transparent dark:border-white/5 transition-all">
              <div className="text-sm sm:text-2xl leading-none mb-0.5">🥽</div>
              <div className="bg-black dark:bg-zinc-800 text-white text-[6px] sm:text-[10px] font-black py-0.5 rounded-sm uppercase leading-tight">Lentes</div>
            </div>
            <div className="bg-white dark:bg-zinc-900/80 p-1 sm:p-3 rounded-lg sm:rounded-xl shadow-sm text-center w-8 sm:w-16 border border-transparent dark:border-white/5 transition-all">
              <div className="text-sm sm:text-2xl leading-none mb-0.5">🥾</div>
              <div className="bg-black dark:bg-zinc-800 text-white text-[6px] sm:text-[10px] font-black py-0.5 rounded-sm uppercase leading-tight">Zapatos</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
