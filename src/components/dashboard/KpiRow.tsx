// Calm + dense KPI row for Dashboard.
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { Density } from '../../store/densityStore';

export type KpiTone = 'brand' | 'attention' | 'alert' | 'success' | 'neutral';

export interface KpiItem {
  id: string;
  label: string;
  value: string | number;
  sub?: string;
  trend?: { dir: 'up' | 'down' | 'flat'; text: string };
  tone?: KpiTone;
  icon?: LucideIcon;
}

const TONE_TEXT: Record<KpiTone, string> = {
  brand: 'text-[var(--accent-primary)]',
  attention: 'text-[var(--accent-warning)]',
  alert: 'text-[var(--accent-hazard)]',
  success: 'text-[var(--accent-success)]',
  neutral: 'text-primary-token',
};

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

interface KpiRowProps {
  items: KpiItem[];
  density?: Density;
}

export function KpiRow({ items, density = 'comfortable' }: KpiRowProps) {
  if (items.length === 0) return null;
  const pad = density === 'compact' ? 'p-1.5 sm:p-2.5' : 'p-2 sm:p-4';
  const valueSize = density === 'compact' ? 'text-sm sm:text-xl' : 'text-base sm:text-2xl';
  return (
    <div
      data-testid="kpi-row"
      className="grid grid-cols-4 gap-1.5 sm:gap-3"
    >
      {items.map((k) => {
        const tone = k.tone ?? 'neutral';
        const TrendIcon = k.trend ? TREND_ICON[k.trend.dir] : null;
        return (
          <div
            key={k.id}
            className={cn(
              'rounded-xl sm:rounded-2xl border border-default-token bg-surface shadow-mode',
              'transition-transform duration-200 hover:-translate-y-0.5',
              pad,
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-xs font-medium text-secondary-token truncate" title={k.label}>
                {k.label}
              </span>
              {k.icon && <k.icon className={cn('w-4 h-4 shrink-0', TONE_TEXT[tone])} aria-hidden="true" />}
            </div>
            <div className={cn('mt-1 font-semibold tabular-nums', valueSize, TONE_TEXT[tone])}>
              {k.value}
            </div>
            <div className="mt-0.5 hidden sm:flex items-center gap-2 min-h-[1rem]">
              {k.sub && <span className="text-xs text-muted-token truncate" title={k.sub}>{k.sub}</span>}
              {k.trend && TrendIcon && (
                <span className="inline-flex items-center gap-0.5 text-xs font-medium text-secondary-token">
                  <TrendIcon className="w-3 h-3" aria-hidden="true" />
                  {k.trend.text}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
