// Praeventio Guard — Compliance score card extracted from Dashboard.tsx (A11 R18).
//
// Displays a circular progress indicator + status label and opens the
// ComplianceModal on click. Owns no state; the parent passes data + handler.

import { Briefcase, Target, TrendingUp } from 'lucide-react';

interface ComplianceCardProps {
  percentage: number;
  label: string;
  onClick: () => void;
}

export function ComplianceCard({ percentage, label, onClick }: ComplianceCardProps) {
  return (
    <section
      onClick={onClick}
      className="rounded-xl sm:rounded-2xl p-1.5 sm:p-4 shadow-sm relative overflow-hidden border bg-white/90 dark:bg-zinc-900/50 border-zinc-500/10 cursor-pointer hover:border-emerald-500/30 transition-colors group flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-between h-auto sm:h-full"
    >
      <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform hidden sm:block">
        <Target className="w-24 h-24 text-emerald-500" />
      </div>

      {/* Mobile Layout: Horizontal */}
      <div className="flex sm:hidden items-center justify-between w-full relative z-10">
        <div className="flex items-center gap-1.5">
          <div className="relative flex items-center justify-center w-6 h-6 shrink-0">
            <svg className="w-full h-full transform -rotate-90 absolute inset-0">
              <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="2" fill="transparent" className="text-zinc-200 dark:text-zinc-800" />
              <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="2" fill="transparent" strokeDasharray={100.5} strokeDashoffset={100.5 * (1 - (percentage / 100))} className="text-emerald-500" />
            </svg>
            <span className="text-[7px] font-black text-zinc-900 dark:text-white relative z-10">{percentage}%</span>
          </div>
          <div className="flex flex-col">
            <h2 className="text-[9px] font-black text-zinc-900 dark:text-white uppercase leading-tight">Cumplimiento</h2>
            <p className="text-[7px] text-zinc-500 dark:text-zinc-400 truncate max-w-[100px]">{label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest">
          Optimizar
        </div>
      </div>

      {/* Desktop Layout: Vertical */}
      <div className="hidden sm:flex flex-col justify-between h-full relative z-10 w-full">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-zinc-900 dark:text-white tracking-tight leading-none uppercase">Cumplimiento</h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1 truncate max-w-[150px]">
              <Briefcase className="w-3 h-3" /> {label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex flex-col items-center justify-center w-14 h-14 shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-zinc-200 dark:text-zinc-800" />
              <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent" strokeDasharray={100.5} strokeDashoffset={100.5 * (1 - (percentage / 100))} className="text-emerald-500" />
            </svg>
            <span className="absolute text-xs font-black text-zinc-900 dark:text-white">
              {percentage}%
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-900 dark:text-white leading-tight truncate">
              {percentage >= 90 ? 'Nivel Óptimo' : percentage >= 70 ? 'Nivel Aceptable' : 'Requiere Atención'}
            </p>
            <div className="flex items-center gap-1 mt-1">
              <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
                Falta {100 - percentage}%
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest shadow-sm w-fit">
          <TrendingUp className="w-3 h-3" /> Optimizar
        </div>
      </div>
    </section>
  );
}
