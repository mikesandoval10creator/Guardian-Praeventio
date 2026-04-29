// Praeventio Guard — Marquee grid of navigation modules extracted from Dashboard.tsx (A11 R18).

import { useNavigate } from 'react-router-dom';
import { moduleGroups } from './moduleGroups';

export function ModuleGroupsGrid() {
  const navigate = useNavigate();

  return (
    <section className="w-full min-w-0 mt-1 sm:mt-4 mb-2 overflow-hidden">
      <div className="flex items-center justify-between mb-1.5 sm:mb-4 px-1">
        <h2 className="text-xs sm:text-base font-black text-zinc-900 dark:text-white tracking-tight leading-none uppercase">Módulos</h2>
      </div>
      <div
        className="relative w-full overflow-hidden"
        style={{ maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)' }}
      >
        <div className="flex w-max animate-marquee hover:[animation-play-state:paused] gap-2 sm:gap-3 pb-2">
          {/* Double the modules array to create a seamless loop */}
          {[...moduleGroups, ...moduleGroups].map((group, i) => (
            <button
              key={i}
              onClick={() => navigate(`/hub/${group.id}`)}
              className={`${group.color} shrink-0 w-[80px] sm:w-[120px] aspect-square rounded-xl sm:rounded-2xl p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-3 shadow-sm hover:shadow-md transition-all hover:-translate-y-1 border border-white/10 active:scale-95 group relative overflow-hidden`}
            >
              <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
              <group.icon className="w-6 h-6 sm:w-8 sm:h-8 shrink-0 relative z-10 text-white" />
              <h3 className="text-[8px] sm:text-xs font-black uppercase tracking-widest leading-tight text-center relative z-10 text-white">{group.title}</h3>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
