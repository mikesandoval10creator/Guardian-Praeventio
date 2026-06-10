// Praeventio Guard — Wire UI #43: <AnnualReviewSummary />
//
// Summary anual del SGI: objetivos achieved vs at_risk vs missed con
// achievementRate + needsAttention list.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Award, AlertCircle, Calendar } from 'lucide-react';
import {
  buildAnnualReview,
  type PreventiveObjective,
} from '../../services/annualReview/annualSgiReview.js';

interface AnnualReviewSummaryProps {
  objectives: PreventiveObjective[];
  fiscalYear: number;
  onObjectiveClick?: (id: string) => void;
}

export function AnnualReviewSummary({
  objectives,
  fiscalYear,
  onObjectiveClick,
}: AnnualReviewSummaryProps) {
  const { t } = useTranslation();
  const review = useMemo(
    () => buildAnnualReview(objectives, fiscalYear),
    [objectives, fiscalYear],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="annual-review-summary"
      aria-label={t('annualReview.aria', 'Resumen anual SGI') as string}
    >
      <header className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('annualReview.title', 'Revisión Anual SGI')} {fiscalYear}
        </h2>
        <span className="ml-auto text-xs text-secondary-token">
          {/* Key renamed objectives→objectives.label: 'annualReview.objectives' is a
              namespace node ('.empty' lives under it), so it cannot also be a leaf. */}
          {review.totalObjectives} {t('annualReview.objectives.label', 'objetivos')}
        </span>
      </header>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div
          className="rounded-lg p-2 bg-emerald-500/10"
          data-testid="annual-counter-achieved"
        >
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
            {review.achieved}
          </p>
          <p className="text-[9px] uppercase opacity-70">
            {t('annualReview.achieved', 'Logrados')}
          </p>
        </div>
        <div className="rounded-lg p-2 bg-sky-500/10" data-testid="annual-counter-ontrack">
          <p className="text-2xl font-black text-sky-700 dark:text-sky-300 tabular-nums">
            {review.onTrack}
          </p>
          <p className="text-[9px] uppercase opacity-70">
            {t('annualReview.onTrack', 'En camino')}
          </p>
        </div>
        <div className="rounded-lg p-2 bg-amber-500/15" data-testid="annual-counter-atrisk">
          <p className="text-2xl font-black text-amber-700 dark:text-amber-300 tabular-nums">
            {review.atRisk}
          </p>
          <p className="text-[9px] uppercase opacity-70">{t('annualReview.atRisk', 'Riesgo')}</p>
        </div>
        <div className="rounded-lg p-2 bg-rose-500/15" data-testid="annual-counter-missed">
          <p className="text-2xl font-black text-rose-700 dark:text-rose-300 tabular-nums">
            {review.missed}
          </p>
          <p className="text-[9px] uppercase opacity-70">{t('annualReview.missed', 'No logr.')}</p>
        </div>
      </div>

      {/* Achievement rate big */}
      <div
        className="rounded-lg bg-surface-elevated p-3 text-center"
        data-testid="annual-achievement-rate"
      >
        <p className="text-[10px] uppercase opacity-70 mb-1">
          {t('annualReview.achievementRate', 'Tasa de logro')}
        </p>
        <p className="text-3xl font-black tabular-nums text-emerald-700 dark:text-emerald-300">
          {review.achievementRate}%
        </p>
      </div>

      {/* Needs attention */}
      {review.needsAttention.length > 0 && (
        <div data-testid="annual-needs-attention">
          <h3 className="text-xs font-bold uppercase text-rose-700 dark:text-rose-300 mb-1 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" aria-hidden="true" />
            {t('annualReview.needsAttention', 'Requieren atención')}
          </h3>
          <ul className="space-y-1">
            {review.needsAttention.map((obj) => (
              <li key={obj.id}>
                <button
                  type="button"
                  onClick={() => onObjectiveClick?.(obj.id)}
                  disabled={!onObjectiveClick}
                  data-testid={`annual-attention-${obj.id}`}
                  className={`w-full text-left text-xs p-1.5 rounded bg-rose-500/5 ${onObjectiveClick ? 'hover:bg-rose-500/10' : ''}`}
                >
                  <p className="font-bold">{obj.title}</p>
                  <p className="text-[10px] opacity-70 mt-0.5">
                    {obj.currentValue} / {obj.target}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Top performers */}
      {review.topPerformers.length > 0 && (
        <div data-testid="annual-top-performers">
          <h3 className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-300 mb-1 flex items-center gap-1">
            <Award className="w-3 h-3" aria-hidden="true" />
            {t('annualReview.topPerformers', 'Logros destacados')}
          </h3>
          <ul className="space-y-1">
            {review.topPerformers.map((obj) => (
              <li
                key={obj.id}
                data-testid={`annual-top-${obj.id}`}
                className="text-xs p-1.5 rounded bg-emerald-500/5 flex items-center gap-1.5"
              >
                <Award className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 font-bold truncate">{obj.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
