// src/components/layout/HeaderModeSwitcher.tsx
import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Car, AlertOctagon } from 'lucide-react';
import { useAppMode } from '../../contexts/AppModeContext';
import { ModeSwitcher } from '../shared/ModeSwitcher';
import { cn } from '../../utils/cn';

/**
 * HeaderModeSwitcher — moves the 4-mode selector OUT of the floating
 * bottom-right dock (which collided with the AI chat launcher z-50 + SOS
 * button) INTO the header. Reuses the existing ModeSwitcher (no duplicated
 * setMode logic); renders it inside an anchored popover.
 */
export function HeaderModeSwitcher() {
  const { mode, appearance } = useAppMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const ActiveIcon =
    mode === 'driving' ? Car
    : mode === 'emergency' ? AlertOctagon
    : appearance === 'dark' ? Moon
    : Sun;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Cambiar modo de visualización"
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm',
          'bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5',
          'text-zinc-800 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-zinc-800',
        )}
      >
        <ActiveIcon className="w-5 h-5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-50">
          <ModeSwitcher />
        </div>
      )}
    </div>
  );
}
