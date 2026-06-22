// Praeventio Guard — Compliance score card (F2 redesign).
// Calm + dense: token-driven, ring progress, all data preserved. Density-aware.

import { Briefcase, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { useDensityStore } from '../../store/densityStore';

interface ComplianceCardProps {
  percentage: number;
  label: string;
  onClick: () => void;
}

export function ComplianceCard({ percentage, label, onClick }: ComplianceCardProps) {
  const { t } = useTranslation();
  const density = useDensityStore((s) => s.density);
  const compact = density === 'compact';

  const level =
    percentage >= 90
      ? t('compliance_card.level_optimal', 'Nivel Óptimo')
      : percentage >= 70
        ? t('compliance_card.level_acceptable', 'Nivel Aceptable')
        : t('compliance_card.level_needs_attention', 'Requiere Atención');

  const ringSize = compact ? 'w-12 h-12' : 'w-14 h-14';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${t('compliance_card.title', 'Cumplimiento')}: ${percentage}% — ${level}`}
      className={cn(
        'group relative overflow-hidden rounded-xl sm:rounded-2xl border border-default-token bg-surface shadow-mode',
        'cursor-pointer text-left transition-colors duration-200 hover:border-strong-token',
        'flex flex-col justify-between h-full w-full',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-primary-token tracking-tight">
          {t('compliance_card.title', 'Cumplimiento')}
        </h2>
        <span className="inline-flex items-center gap-1 text-xs text-secondary-token truncate max-w-[55%]" title={label}>
          <Briefcase className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {label}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className={cn('relative flex items-center justify-center shrink-0', ringSize)}>
          <svg className="w-full h-full -rotate-90" aria-hidden="true">
            <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-[var(--border-strong)]" />
            <circle
              cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent"
              strokeDasharray={100.5} strokeDashoffset={100.5 * (1 - percentage / 100)}
              className="text-[var(--accent-success)] transition-[stroke-dashoffset] duration-500"
            />
          </svg>
          <span className="absolute text-sm font-semibold text-primary-token tabular-nums">{percentage}%</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-primary-token leading-tight">{level}</p>
          <p className="text-xs text-muted-token mt-0.5">
            {t('compliance_card.remaining', 'Falta {{remaining}}%', { remaining: 100 - percentage })}
          </p>
        </div>
      </div>

      <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--accent-success)_14%,transparent)] px-2 py-1 text-xs font-semibold text-[var(--accent-success)]">
        <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" /> {t('compliance_card.optimize', 'Optimizar')}
      </span>
    </button>
  );
}
