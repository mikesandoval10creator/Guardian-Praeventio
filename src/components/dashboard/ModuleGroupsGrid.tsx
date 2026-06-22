// Praeventio Guard — Marquee grid of navigation modules.
//
// Sprint B PR #517: enhanced with inline submenu drawer. Clicking a group
// card now toggles a drawer below the marquee that surfaces the group's
// items (sub-categories) without forcing a full navigation to /hub/:id.
// User can navigate directly to a leaf page, or hit "Ver hub completo"
// at the end of the drawer to land on the legacy hub page. Escape key +
// click outside close the drawer.
//
// User directive 2026-05-27: "potenciemos ese carrusel, pongamos menus y
// submenus donde corresponda de acuerdo a la categoría o clasificación".
//
// A11y:
// - Each group card is `aria-haspopup="menu"` + `aria-expanded` reflecting
//   the open state, so screen readers announce the drawer relationship.
// - The drawer is a `role="region"` with `aria-labelledby` pointing at the
//   active group's heading.
// - Submenu items are buttons (not anchors) so keyboard activation matches
//   the rest of the dashboard. Tab order is natural.
// - Escape key closes the drawer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, X } from 'lucide-react';
import { moduleGroups } from './moduleGroups';

export function ModuleGroupsGrid() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setActiveId(null), []);

  // Escape key closes the drawer.
  useEffect(() => {
    if (!activeId) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, close]);

  // Click outside the section closes the drawer.
  useEffect(() => {
    if (!activeId) return undefined;
    const onPointer = (e: PointerEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [activeId, close]);

  const activeGroup = activeId
    ? moduleGroups.find((g) => g.id === activeId) ?? null
    : null;

  return (
    <section
      ref={containerRef}
      className="w-full min-w-0 mt-1 sm:mt-4 mb-2 overflow-hidden"
    >
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
        {/* Marquee animation pauses on hover OR while a drawer is open so the
            user can interact without the carousel scrolling away. */}
        <div
          className={`flex w-max gap-2 sm:gap-3 pb-2 ${
            activeId
              ? '[animation-play-state:paused]'
              : 'animate-marquee hover:[animation-play-state:paused]'
          }`}
        >
          {[...moduleGroups, ...moduleGroups].map((group, i) => {
            const isClone = i >= moduleGroups.length;
            const isActive = group.id === activeId;
            return (
              <button
                key={`${group.id}-${i}`}
                onClick={() =>
                  setActiveId((prev) => (prev === group.id ? null : group.id))
                }
                {...(!isClone && {
                  'aria-haspopup': 'menu' as const,
                  'aria-expanded': isActive,
                  'aria-controls': isActive ? `module-submenu-${group.id}` : undefined,
                })}
                {...(isClone && {
                  'aria-hidden': true,
                  tabIndex: -1,
                })}
                className={`${group.color} shrink-0 w-[80px] sm:w-[120px] aspect-square rounded-xl sm:rounded-2xl p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-3 shadow-sm hover:shadow-md transition-all hover:-translate-y-1 border ${
                  isActive ? 'border-white/40 ring-2 ring-white/30' : 'border-white/10'
                } active:scale-95 group relative overflow-hidden`}
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

      {/* Inline submenu drawer — Sprint B PR #517. Renders the active
          group's items as a horizontal scrollable row so the user can dive
          into a leaf page (e.g. /workers) without leaving the dashboard.
          The "Ver hub completo" button at the end preserves the legacy
          navigation contract (/hub/:id). */}
      {activeGroup && (
        <div
          id={`module-submenu-${activeGroup.id}`}
          role="region"
          aria-labelledby={`module-submenu-${activeGroup.id}-title`}
          className="mt-2 px-2 sm:px-3 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-default-token bg-surface animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="flex items-center justify-between mb-2 sm:mb-3 px-1">
            <h3
              id={`module-submenu-${activeGroup.id}-title`}
              className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-primary-token"
            >
              {t(`module_groups.group_${activeGroup.id}`, activeGroup.title)}
            </h3>
            <button
              type="button"
              onClick={close}
              aria-label={t('module_groups.close', 'Cerrar submenú')}
              className="p-1 rounded-md text-muted-token hover:text-primary-token hover:bg-canvas transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {activeGroup.items.map((item) => (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  close();
                }}
                role="menuitem"
                className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated border border-default-token hover:border-teal-400 hover:bg-canvas transition-colors text-xs font-bold text-primary-token"
              >
                <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
                <span>{item.title}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                navigate(`/hub/${activeGroup.id}`);
                close();
              }}
              className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-black uppercase tracking-widest"
            >
              {t('module_groups.see_hub', 'Ver hub')}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
