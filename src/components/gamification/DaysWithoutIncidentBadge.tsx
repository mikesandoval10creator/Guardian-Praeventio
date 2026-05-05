// SPDX-License-Identifier: MIT
//
// Sprint 29 Bucket DD F-D — Días-sin-incidentes badge.
//
// Renders the running "días limpios" counter with a color tier scaled by
// streak length:
//   • verde     0–30   (early streak)
//   • dorado    31–100 (consolidating)
//   • plateado  101–365 (resilient)
//   • gold      365+   (legendary, with extra glow)
//
// Pure presentational. Production callers pass `days` from the projectsContext
// or from the Sprint 29 cron snapshot persisted on `gamification_scores`.

import { ShieldCheck, Sparkles } from 'lucide-react';

export type DaysTier = 'green' | 'dorado' | 'plateado' | 'gold';

export function tierForDays(days: number): DaysTier {
  if (!Number.isFinite(days) || days < 0) return 'green';
  if (days <= 30) return 'green';
  if (days <= 100) return 'dorado';
  if (days <= 365) return 'plateado';
  return 'gold';
}

const TIER_STYLES: Record<DaysTier, { bg: string; text: string; ring: string; label: string }> = {
  green: {
    bg: 'bg-emerald-100 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    ring: 'ring-emerald-300 dark:ring-emerald-500/40',
    label: 'En racha',
  },
  dorado: {
    bg: 'bg-amber-100 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    ring: 'ring-amber-300 dark:ring-amber-500/40',
    label: 'Consolidado',
  },
  plateado: {
    bg: 'bg-slate-200 dark:bg-slate-500/15',
    text: 'text-slate-700 dark:text-slate-300',
    ring: 'ring-slate-300 dark:ring-slate-500/40',
    label: 'Resiliente',
  },
  gold: {
    bg: 'bg-yellow-100 dark:bg-yellow-500/15',
    text: 'text-yellow-700 dark:text-yellow-200',
    ring: 'ring-yellow-300 dark:ring-yellow-500/40',
    label: 'Leyenda',
  },
};

export interface DaysWithoutIncidentBadgeProps {
  days: number;
  /** When true the badge takes a horizontal pill shape (for headers). */
  compact?: boolean;
}

export function DaysWithoutIncidentBadge({ days, compact }: DaysWithoutIncidentBadgeProps) {
  const safeDays = Number.isFinite(days) && days >= 0 ? Math.floor(days) : 0;
  const tier = tierForDays(safeDays);
  const style = TIER_STYLES[tier];

  if (compact) {
    return (
      <span
        data-tier={tier}
        aria-label={`${safeDays} días sin incidentes`}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full ring-1 ${style.bg} ${style.text} ${style.ring}`}
      >
        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="text-xs font-black tracking-widest">
          {safeDays} días
        </span>
      </span>
    );
  }

  return (
    <div
      data-tier={tier}
      aria-label={`${safeDays} días sin incidentes`}
      className={`flex flex-col items-center justify-center p-4 rounded-2xl ring-2 ${style.bg} ${style.text} ${style.ring}`}
    >
      <div className="flex items-center gap-2">
        {tier === 'gold' ? (
          <Sparkles className="w-5 h-5" aria-hidden="true" />
        ) : (
          <ShieldCheck className="w-5 h-5" aria-hidden="true" />
        )}
        <span className="text-[10px] font-black uppercase tracking-[0.2em]">
          {style.label}
        </span>
      </div>
      <span className="text-3xl font-black mt-1">{safeDays}</span>
      <span className="text-[10px] uppercase tracking-widest opacity-80">
        días sin incidentes
      </span>
    </div>
  );
}

export default DaysWithoutIncidentBadge;
