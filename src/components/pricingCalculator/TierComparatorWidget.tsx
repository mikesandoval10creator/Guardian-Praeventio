// Praeventio Guard — Wire UI #38: <TierComparatorWidget />
//
// Compara N tiers para un uso dado. Resalta el recomendado.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Receipt, CheckCircle2 } from 'lucide-react';
import {
  compareTiers,
  type TierPlan,
  type CurrentUsage,
} from '../../services/pricingCalculator/pricingCalculator.js';

interface TierComparatorWidgetProps {
  plans: TierPlan[];
  usage: CurrentUsage;
  onSelectTier?: (tierId: string) => void;
}

function formatClp(n: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);
}

export function TierComparatorWidget({
  plans,
  usage,
  onSelectTier,
}: TierComparatorWidgetProps) {
  const { t } = useTranslation();
  const comparison = useMemo(() => compareTiers(plans, usage), [plans, usage]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="tier-comparator"
      aria-label={t('tiers.aria', 'Comparador de planes') as string}
    >
      <header className="flex items-center gap-2">
        <Receipt className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('tiers.title', 'Comparar planes')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token">
          {t('tiers.usageLabel', 'Uso:')} {usage.activeWorkers}{' '}
          {t('tiers.workersShort', 'trab.')} · {usage.activeProjects}{' '}
          {t('tiers.projectsShort', 'proyectos')}
        </span>
      </header>

      <ul className="space-y-2">
        {comparison.estimates.map((e) => {
          const isRecommended = e.tierId === comparison.recommended?.tierId;
          return (
            <li
              key={e.tierId}
              data-testid={`tier-row-${e.tierId}`}
              className={`rounded-lg border p-3 ${
                isRecommended
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-default-token bg-surface-elevated'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectTier?.(e.tierId)}
                disabled={!onSelectTier}
                className={`w-full text-left ${onSelectTier ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-primary-token uppercase">
                    {e.tierId}
                  </span>
                  {isRecommended && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-white"
                      data-testid={`tier-recommended-${e.tierId}`}
                    >
                      <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                      {t('tiers.recommended', 'Recomendado')}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-secondary-token">
                    {formatClp(e.basePriceClp)} {t('tiers.baseLabel', 'base')}
                    {(e.workerOverageClp > 0 || e.projectOverageClp > 0) && (
                      <>
                        {' '}+ {formatClp(e.workerOverageClp + e.projectOverageClp)}{' '}
                        {t('tiers.overageLabel', 'extra')}
                      </>
                    )}
                  </span>
                  <span className="text-sm font-black tabular-nums">
                    {formatClp(e.totalMonthlyClp)}
                    <span className="text-[10px] opacity-70">/mes</span>
                  </span>
                </div>
                {!e.fitsInPlan && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
                    {e.workersOver > 0 &&
                      t('tiers.workersOver', `${e.workersOver} trab. sobre el plan`)}
                    {e.workersOver > 0 && e.projectsOver > 0 && ' · '}
                    {e.projectsOver > 0 &&
                      t('tiers.projectsOver', `${e.projectsOver} proyectos sobre el plan`)}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
