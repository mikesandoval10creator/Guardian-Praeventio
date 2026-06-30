// Praeventio Guard — Marquee carousel of navigation module GROUPS.
//
// 2026-06-28 (founder UX, glove-friendly): tocar un grupo NAVEGA a su página
// dedicada `/hub/:id` (ModuleHub) — NO abre un cajón/lista inline. Razón de
// terreno: la app se usa CON GUANTES; una tarjeta grande → página completa es
// mucho más usable que un drawer chiquito. Igual que el prototipo praevium-guard
// (navegación directa a páginas). La página hub es donde el usuario drillea más
// profundo; RootLayout provee los botones "atrás" + "volver al dashboard".
//
// El marquee auto-scrollea lento (animate-marquee) y pausa al hover. La copia
// duplicada (segunda mitad) es aria-hidden para no duplicar en accesibilidad.

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { moduleGroups } from './moduleGroups';

export function ModuleGroupsGrid() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <section className="w-full min-w-0 shrink-0 mt-1 sm:mt-4 mb-2 overflow-hidden">
      <div className="flex items-center justify-between mb-1.5 sm:mb-4 px-1">
        <h2 className="text-sm sm:text-base font-semibold text-primary-token tracking-tight">
          {t('module_groups.heading', 'Módulos')}
        </h2>
      </div>

      <div
        className="relative w-full overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(to right, transparent, black 5%, black 95%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 5%, black 95%, transparent)',
        }}
      >
        <div className="flex w-max gap-2 sm:gap-3 pb-2 animate-marquee hover:[animation-play-state:paused]">
          {[...moduleGroups, ...moduleGroups].map((group, i) => {
            const isClone = i >= moduleGroups.length;
            return (
              <button
                key={`${group.id}-${i}`}
                onClick={() => navigate(`/hub/${group.id}`)}
                {...(isClone && { 'aria-hidden': true, tabIndex: -1 })}
                className={`${group.color} shrink-0 w-[80px] sm:w-[120px] aspect-square rounded-xl sm:rounded-2xl p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-3 shadow-sm hover:shadow-md transition-all hover:-translate-y-1 border border-white/10 active:scale-95 group relative overflow-hidden`}
              >
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
                <group.icon className="w-6 h-6 sm:w-8 sm:h-8 shrink-0 relative z-10 text-white" />
                <h3 className="text-[8px] sm:text-xs font-black uppercase tracking-widest leading-tight text-center relative z-10 text-white">
                  {t(`module_groups.group_${group.id}`, group.title)}
                </h3>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
