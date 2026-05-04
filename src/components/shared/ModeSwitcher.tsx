import type { ReactElement } from 'react';
import { Sun, Moon, Car, AlertOctagon, X } from 'lucide-react';
import { useAppMode, AppMode, AppAppearance } from '../../contexts/AppModeContext';

/**
 * ModeSwitcher — exposes the 4 UX modes (normal-light, normal-dark,
 * driving, emergency) through a small button row. Self-contained;
 * mounts anywhere a `useAppMode()` provider is available.
 */

interface SlotDef {
  key: 'normal-light' | 'normal-dark' | 'driving' | 'emergency';
  label: string;
  /**
   * Verbose `aria-label` describing the action the button performs and
   * the target mode. Required for WCAG 4.1.2 (Name, Role, Value):
   * `<title>` and `<span class="sr-only">` alone are not consistently
   * announced as the button's accessible name across screen readers.
   */
  ariaLabel: string;
  Icon: typeof Sun;
  mode: AppMode;
  appearance?: AppAppearance;
  hint?: string;
}

const SLOTS: SlotDef[] = [
  { key: 'normal-light', label: 'Claro',     ariaLabel: 'Activar modo claro',                             Icon: Sun,           mode: 'normal',    appearance: 'light' },
  { key: 'normal-dark',  label: 'Oscuro',    ariaLabel: 'Activar modo oscuro',                            Icon: Moon,          mode: 'normal',    appearance: 'dark'  },
  { key: 'driving',      label: 'Conducir',  ariaLabel: 'Activar modo conducción (día/noche automático)', Icon: Car,           mode: 'driving',                       hint: 'Auto día/noche' },
  { key: 'emergency',    label: 'Emergencia',ariaLabel: 'Activar modo emergencia',                        Icon: AlertOctagon,  mode: 'emergency'                      },
];

function isActive(slot: SlotDef, mode: AppMode, appearance: AppAppearance): boolean {
  if (slot.mode !== mode) return false;
  if (slot.mode === 'normal') return slot.appearance === appearance;
  return true;
}

export function ModeSwitcher(): ReactElement {
  const { mode, appearance, setMode, setAppearance, dismissEmergency } = useAppMode();

  const handleSelect = (slot: SlotDef): void => {
    if (slot.mode === 'normal' && slot.appearance) {
      setAppearance(slot.appearance);
      setMode('normal');
    } else {
      setMode(slot.mode);
    }
  };

  return (
    <div
      className="inline-flex flex-col gap-2 rounded-2xl p-2"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        boxShadow: '0 6px 20px var(--shadow-color)',
      }}
      role="group"
      aria-label="Selector de modo de UX"
    >
      <div className="flex items-center gap-1.5">
        {SLOTS.map((slot) => {
          const active = isActive(slot, mode, appearance);
          const isEmergencySlot = slot.mode === 'emergency';
          const Icon = slot.Icon;
          return (
            <button
              key={slot.key}
              type="button"
              onClick={() => handleSelect(slot)}
              aria-pressed={active}
              aria-label={slot.ariaLabel}
              title={slot.label}
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
                isEmergencySlot && active ? 'animate-pulse' : ''
              }`}
              style={
                active
                  ? {
                      backgroundColor: 'var(--accent-primary)',
                      color: 'var(--accent-on-primary)',
                      boxShadow: isEmergencySlot
                        ? '0 0 0 4px var(--shadow-color)'
                        : 'inset 0 1px 2px rgba(0,0,0,0.2)',
                    }
                  : {
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="sr-only">{slot.label}</span>
            </button>
          );
        })}
        {mode === 'emergency' && (
          <button
            type="button"
            onClick={dismissEmergency}
            title="Cancelar emergencia"
            aria-label="Cancelar emergencia"
            className="flex h-10 w-8 items-center justify-center rounded-xl transition-all"
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--accent-hazard)',
              border: '1px solid var(--border-strong)',
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {mode === 'driving' && (
        <span
          className="text-[10px] font-medium uppercase tracking-wider text-center"
          style={{ color: 'var(--text-muted)' }}
        >
          Auto día/noche
        </span>
      )}
    </div>
  );
}
