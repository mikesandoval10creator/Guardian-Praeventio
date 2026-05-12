// Praeventio Guard — Wire UI: <RootCauseClassifierCard />
//
// Muestra un análisis de causa raíz + agregados (stats) si se proveen.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, AlertCircle, ListChecks, TrendingDown } from 'lucide-react';
import {
  computeStats,
  type RootCauseAnalysis,
  type CauseFactor,
} from '../../services/rootCause/rootCauseClassifier.js';

interface RootCauseClassifierCardProps {
  analysis: RootCauseAnalysis;
  /** Análisis previos del tenant para agregados. */
  history?: RootCauseAnalysis[];
}

const FACTOR_LABELS: Record<CauseFactor, string> = {
  condicion_subestandar: 'Condición sub-estándar',
  acto_subestandar: 'Acto sub-estándar',
  falla_supervision: 'Falla supervisión',
  falla_procedimiento: 'Falla procedimiento',
  falla_mantenimiento: 'Falla mantenimiento',
  factor_ambiental: 'Factor ambiental',
  factor_organizacional: 'Factor organizacional',
  falla_capacitacion: 'Falla capacitación',
  falla_epp: 'Falla EPP',
  falla_diseno: 'Falla diseño',
};

export function RootCauseClassifierCard({
  analysis,
  history,
}: RootCauseClassifierCardProps) {
  const { t } = useTranslation();
  const stats = useMemo(
    () => (history && history.length > 0 ? computeStats(history) : null),
    [history],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="root-cause-card"
      aria-label={t('rootCause.aria', 'Análisis de causa raíz') as string}
    >
      <header className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-indigo-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('rootCause.title', 'Causa Raíz')}
        </h2>
        <span
          className="ml-auto text-[10px] text-secondary-token"
          data-testid="rc-incident-id"
        >
          {analysis.incidentId}
        </span>
      </header>

      <div data-testid="rc-primary">
        <p className="text-[10px] uppercase text-secondary-token opacity-70">
          {t('rootCause.primary', 'Factor principal')}
        </p>
        <p className="text-sm font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" aria-hidden="true" />
          {t(
            `rootCause.factor.${analysis.primaryFactor}`,
            FACTOR_LABELS[analysis.primaryFactor],
          )}
        </p>
      </div>

      <div data-testid="rc-factors">
        <p className="text-[10px] uppercase text-secondary-token opacity-70 mb-1">
          {t('rootCause.factors', 'Factores')}
        </p>
        <ul className="flex flex-wrap gap-1">
          {analysis.factors.map((f) => (
            <li
              key={f}
              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                f === analysis.primaryFactor
                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                  : 'bg-surface-elevated text-secondary-token'
              }`}
            >
              {t(`rootCause.factor.${f}`, FACTOR_LABELS[f])}
            </li>
          ))}
        </ul>
      </div>

      <div data-testid="rc-five-whys">
        <p className="text-[10px] uppercase text-secondary-token opacity-70 mb-1">
          {t('rootCause.fiveWhys', '5 Porqués')}
        </p>
        <ol className="space-y-1 list-decimal list-inside">
          {analysis.fiveWhys.map((w, i) => (
            <li key={i} className="text-[11px] text-primary-token">
              {w}
            </li>
          ))}
        </ol>
      </div>

      <div data-testid="rc-actions">
        <p className="text-[10px] uppercase text-secondary-token opacity-70 mb-1 flex items-center gap-1">
          <ListChecks className="w-3 h-3" aria-hidden="true" />
          {t('rootCause.actions', 'Acciones sugeridas')}
        </p>
        <ul className="space-y-1">
          {analysis.suggestedActions.map((a, i) => (
            <li
              key={i}
              className="text-[11px] text-primary-token bg-emerald-500/5 p-1.5 rounded"
            >
              {a}
            </li>
          ))}
        </ul>
      </div>

      {stats && (
        <div data-testid="rc-stats" className="border-t border-default-token pt-2">
          <p className="text-[10px] uppercase text-secondary-token opacity-70 mb-1 flex items-center gap-1">
            <TrendingDown className="w-3 h-3" aria-hidden="true" />
            {t('rootCause.topFactors', 'Top factores históricos')} (
            {stats.totalAnalyses})
          </p>
          <ul className="space-y-0.5">
            {stats.topPrimaryFactors.map((tp) => (
              <li
                key={tp.factor}
                className="text-[11px] flex justify-between"
                data-testid={`rc-stat-${tp.factor}`}
              >
                <span>{t(`rootCause.factor.${tp.factor}`, FACTOR_LABELS[tp.factor])}</span>
                <span className="font-bold">{tp.percentOfTotal}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
