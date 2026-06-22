import { Rows3, Rows4 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useDensityStore, type Density } from '../../store/densityStore';

const OPTIONS: { value: Density; label: string; icon: typeof Rows3 }[] = [
  { value: 'comfortable', label: 'Cómodo', icon: Rows3 },
  { value: 'compact', label: 'Compacto', icon: Rows4 },
];

export function DensityToggle() {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);
  return (
    <div
      role="group"
      aria-label="Densidad de la información"
      className="inline-flex items-center gap-0.5 rounded-xl border border-default-token bg-surface p-0.5 shadow-mode"
    >
      {OPTIONS.map((o) => {
        const active = density === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => setDensity(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors duration-200',
              active
                ? 'bg-[var(--accent-primary)] text-[var(--accent-on-primary)]'
                : 'text-secondary-token hover:text-primary-token',
            )}
          >
            <o.icon className="w-3.5 h-3.5" aria-hidden="true" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
