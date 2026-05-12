// Praeventio Guard — Wire UI #19: <PreventiveObjectivesPanel />
//
// Panel ejecutivo de objetivos preventivos del año fiscal con progreso
// individual + flag de los que requieren atención.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Target, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  computeObjectiveProgress,
  type PreventiveObjective,
} from '../../services/annualReview/annualSgiReview.js';

interface PreventiveObjectivesPanelProps {
  objectives: PreventiveObjective[];
  onObjectiveClick?: (id: string) => void;
}

const STATUS_CLASS = {
  achieved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  on_track: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  at_risk: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  missed: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  planned: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
  in_progress: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
};

export function PreventiveObjectivesPanel({
  objectives,
  onObjectiveClick,
}: PreventiveObjectivesPanelProps) {
  const { t } = useTranslation();

  const enriched = useMemo(
    () =>
      objectives
        .map((obj) => ({ obj, progress: computeObjectiveProgress(obj) }))
        .sort((a, b) => a.progress.progressPercent - b.progress.progressPercent),
    [objectives],
  );

  if (enriched.length === 0) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-6 text-center text-secondary-token"
        data-testid="objectives-panel-empty"
      >
        <Target className="w-6 h-6 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <p className="text-xs">
          {t('objectives.empty', 'Sin objetivos preventivos definidos para el período.')}
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="objectives-panel"
      aria-label={t('objectives.aria', 'Panel objetivos preventivos') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('objectives.title', 'Objetivos Preventivos')}
        </h2>
        <span className="ml-auto text-xs text-secondary-token">{enriched.length}</span>
      </header>

      <ul className="space-y-3">
        {enriched.map(({ obj, progress }) => {
          const Icon =
            progress.suggestedStatus === 'achieved'
              ? CheckCircle2
              : progress.suggestedStatus === 'at_risk' || progress.suggestedStatus === 'missed'
                ? AlertTriangle
                : Target;
          return (
            <li
              key={obj.id}
              data-testid={`objective-${obj.id}`}
              className={`rounded-lg border p-3 ${STATUS_CLASS[progress.suggestedStatus]}`}
            >
              <button
                type="button"
                onClick={() => onObjectiveClick?.(obj.id)}
                disabled={!onObjectiveClick}
                className={`w-full text-left ${onObjectiveClick ? 'cursor-pointer hover:brightness-110' : 'cursor-default'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="text-xs font-bold leading-tight flex items-center gap-1.5">
                    <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {obj.title}
                  </h3>
                  <span className="text-xs font-black tabular-nums">
                    {progress.progressPercent}%
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 rounded-full bg-current/10 overflow-hidden mt-1">
                  <div
                    className="h-full bg-current rounded-full"
                    style={{ width: `${progress.progressPercent}%` }}
                    aria-hidden="true"
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] mt-1.5 opacity-80">
                  <span>
                    {obj.currentValue} / {obj.target}
                  </span>
                  <span>
                    {progress.daysRemaining > 0
                      ? t('objectives.daysLeft', `${progress.daysRemaining}d restantes`, {
                          n: progress.daysRemaining,
                        }).replace('{{n}}', String(progress.daysRemaining))
                      : t('objectives.overdue', `${Math.abs(progress.daysRemaining)}d vencido`, {
                          n: Math.abs(progress.daysRemaining),
                        }).replace('{{n}}', String(Math.abs(progress.daysRemaining)))}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
