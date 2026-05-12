// Praeventio Guard — Wire UI #70: <PredictiveAlertsList />
//
// Lista alertas predictivas Bernoulli activas (15 generadores).
// Cada alerta: lead-time, recomendación, acción "atendido" para XP+.

import { useTranslation } from 'react-i18next';
import { Zap, Clock } from 'lucide-react';
import type { ScheduledAlert } from '../../services/predictiveAlerts/alertScheduler.js';

interface PredictiveAlertsListProps {
  alerts: ScheduledAlert[];
  onAcknowledge?: (alert: ScheduledAlert) => void;
}

export function PredictiveAlertsList({ alerts, onAcknowledge }: PredictiveAlertsListProps) {
  const { t } = useTranslation();

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="predictive-alerts-list"
      aria-label={t('predictiveAlerts.aria', 'Alertas predictivas') as string}
    >
      <header className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-fuchsia-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('predictiveAlerts.title', 'Alertas predictivas')}
        </h2>
        <span className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums">
          {alerts.length} {t('predictiveAlerts.active', 'activas')}
        </span>
      </header>

      {alerts.length === 0 ? (
        <p
          className="text-[11px] text-secondary-token italic"
          data-testid="predictive-alerts-empty"
        >
          {t('predictiveAlerts.empty', 'Sin alertas. Todos los generadores Bernoulli en verde.')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="predictive-alerts-items">
          {alerts.map((a, i) => (
            <li
              key={`${a.generatorId}-${i}`}
              data-testid={`predictive-alert-${a.generatorId}`}
              className="bg-fuchsia-500/5 rounded p-2 space-y-1"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300">
                  {a.generatorId}
                </span>
                <span className="ml-auto flex items-center gap-1 text-[10px] text-secondary-token tabular-nums">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {a.decision.leadTimeMin} min
                </span>
              </div>
              <p className="text-[11px]">{a.body}</p>
              <p className="text-[9px] uppercase text-secondary-token tabular-nums">
                {a.scheduledAt.slice(0, 16).replace('T', ' ')}
              </p>
              {onAcknowledge && (
                <button
                  type="button"
                  onClick={() => onAcknowledge(a)}
                  data-testid={`predictive-alert-ack-${a.generatorId}`}
                  className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 underline"
                >
                  {t('predictiveAlerts.acknowledge', 'Atendido')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
