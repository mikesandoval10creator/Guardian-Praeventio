// Praeventio Guard — Quick action bar extracted from Dashboard.tsx (A11 R18).
//
// NOTE: This is the bar that lives directly on the Dashboard (Fast Check /
// Planificador / Emergencia / Mapa Vivo). The pre-existing
// `QuickActions.tsx` in this folder is unrelated and unused at present;
// renaming this one avoids a name collision while keeping git diffs minimal.

import { Eye, Target, Zap, Map } from 'lucide-react';
import { Link } from 'react-router-dom';

interface DashboardQuickActionsProps {
  onFastCheck: () => void;
  onPlanner: () => void;
}

export function DashboardQuickActions({ onFastCheck, onPlanner }: DashboardQuickActionsProps) {
  return (
    <section className="grid grid-cols-4 gap-1 sm:gap-3 w-full mt-1 sm:mt-0">
      <button
        onClick={onFastCheck}
        className="flex-1 bg-[var(--btn-primary-bg)] hover:opacity-80 text-[var(--btn-primary-text,white)] px-0.5 py-1 sm:py-2 rounded-lg sm:rounded-xl font-black uppercase tracking-widest text-[7px] sm:text-xs shadow-sm transition-transform hover:scale-105 flex flex-col items-center justify-center gap-0.5 overflow-hidden"
      >
        <Eye className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span className="truncate">Fast Check</span>
      </button>
      <button
        onClick={onPlanner}
        className="flex-1 bg-[var(--btn-secondary-bg)] hover:opacity-80 text-[var(--btn-secondary-text,white)] px-0.5 py-1 sm:py-2 rounded-lg sm:rounded-xl font-black uppercase tracking-widest text-[7px] sm:text-xs shadow-sm transition-transform hover:scale-105 flex flex-col items-center justify-center gap-0.5 overflow-hidden"
      >
        <Target className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span className="truncate">Planificador</span>
      </button>
      <Link to="/emergency" className="flex-1 bg-[#EF4444] hover:bg-[#DC2626] text-white px-0.5 py-1 sm:py-2 rounded-lg sm:rounded-xl font-black uppercase tracking-widest text-[7px] sm:text-xs shadow-sm transition-transform hover:scale-105 flex flex-col items-center justify-center gap-0.5 overflow-hidden">
        <Zap className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span className="truncate">Emergencia</span>
      </Link>
      <Link to="/site-map" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-0.5 py-1 sm:py-2 rounded-lg sm:rounded-xl font-black uppercase tracking-widest text-[7px] sm:text-xs shadow-sm transition-transform hover:scale-105 flex flex-col items-center justify-center gap-0.5 overflow-hidden">
        <Map className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span className="truncate">Mapa Vivo</span>
      </Link>
    </section>
  );
}
