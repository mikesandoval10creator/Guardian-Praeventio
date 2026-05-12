// Praeventio Guard — Wire UI #33: <ClimatePlanAdjustment />
//
// Vista del plan diario ajustado por clima: cuántas tareas suspendidas,
// reprogramadas, con controles adicionales o que proceden.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudRain, Pause, Clock, Shield, CheckCircle2 } from 'lucide-react';
import {
  buildDailyPlanAdjustment,
  type WeatherConditions,
  type ScheduledTask,
  type WeatherDecision,
} from '../../services/climateAwareScheduling/climateAwareScheduling.js';

interface ClimatePlanAdjustmentProps {
  tasks: ScheduledTask[];
  weather: WeatherConditions;
  onTaskClick?: (taskId: string) => void;
}

const DECISION_CLASS: Record<WeatherDecision, string> = {
  proceed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  add_controls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  reschedule: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  suspend: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

const DECISION_ICON: Record<WeatherDecision, typeof CheckCircle2> = {
  proceed: CheckCircle2,
  add_controls: Shield,
  reschedule: Clock,
  suspend: Pause,
};

const DECISION_LABEL: Record<WeatherDecision, string> = {
  proceed: 'Continuar',
  add_controls: 'Agregar controles',
  reschedule: 'Reprogramar',
  suspend: 'Suspender',
};

export function ClimatePlanAdjustment({
  tasks,
  weather,
  onTaskClick,
}: ClimatePlanAdjustmentProps) {
  const { t } = useTranslation();
  const plan = useMemo(
    () => buildDailyPlanAdjustment(tasks, weather),
    [tasks, weather],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="climate-plan"
      aria-label={t('climate.aria', 'Plan ajustado por clima') as string}
    >
      <header className="flex items-center gap-2">
        <CloudRain className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('climate.title', 'Plan ajustado por clima')}
        </h2>
      </header>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div
          className="rounded-lg p-2 bg-emerald-500/10"
          data-testid="climate-counter-proceed"
        >
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
            {plan.proceed}
          </p>
          <p className="text-[9px] uppercase text-emerald-700/80 dark:text-emerald-300/80">
            {t('climate.proceedLabel', 'Continúan')}
          </p>
        </div>
        <div className="rounded-lg p-2 bg-sky-500/10" data-testid="climate-counter-controls">
          <p className="text-2xl font-black text-sky-700 dark:text-sky-300 tabular-nums">
            {plan.addControls}
          </p>
          <p className="text-[9px] uppercase text-sky-700/80 dark:text-sky-300/80">
            {t('climate.controlsLabel', 'Controles')}
          </p>
        </div>
        <div className="rounded-lg p-2 bg-amber-500/15" data-testid="climate-counter-reschedule">
          <p className="text-2xl font-black text-amber-700 dark:text-amber-300 tabular-nums">
            {plan.reschedule}
          </p>
          <p className="text-[9px] uppercase text-amber-700/80 dark:text-amber-300/80">
            {t('climate.rescheduleLabel', 'Reprog.')}
          </p>
        </div>
        <div className="rounded-lg p-2 bg-rose-500/20" data-testid="climate-counter-suspend">
          <p className="text-2xl font-black text-rose-700 dark:text-rose-300 tabular-nums">
            {plan.suspend}
          </p>
          <p className="text-[9px] uppercase text-rose-700/80 dark:text-rose-300/80">
            {t('climate.suspendLabel', 'Suspendidas')}
          </p>
        </div>
      </div>

      {plan.assessments.length > 0 && (
        <ul className="space-y-1.5">
          {plan.assessments
            .filter((a) => a.decision !== 'proceed')
            .map((a) => {
              const Icon = DECISION_ICON[a.decision];
              return (
                <li key={a.taskId}>
                  <button
                    type="button"
                    onClick={() => onTaskClick?.(a.taskId)}
                    disabled={!onTaskClick}
                    data-testid={`climate-task-${a.taskId}`}
                    className={`w-full text-left rounded-lg border p-2 ${DECISION_CLASS[a.decision]} ${onTaskClick ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span className="text-xs font-bold flex-1 truncate">
                        {a.taskId} · {a.category}
                      </span>
                      <span className="text-[10px] uppercase">{DECISION_LABEL[a.decision]}</span>
                    </div>
                    {a.reasons.length > 0 && (
                      <p className="text-[10px] opacity-80 leading-snug">
                        {a.reasons[0]}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}
