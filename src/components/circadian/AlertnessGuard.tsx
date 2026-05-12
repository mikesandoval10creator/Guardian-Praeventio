// Praeventio Guard — Wire UI #23: <AlertnessGuard />
//
// Banner que muestra al trabajador su nivel de alerta circadiana antes
// de iniciar una tarea crítica. Si está en ventana de bajo alerta o
// con sueño insuficiente, bloquea operación de equipos críticos.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, AlertTriangle, Moon, CheckCircle2 } from 'lucide-react';
import {
  assessAlertness,
  type CircadianInput,
} from '../../services/circadian/circadianRhythmService.js';

interface AlertnessGuardProps {
  input: CircadianInput;
  /** Si el caller necesita que el guard bloquee operación crítica. */
  blockingCriticalOperation?: boolean;
}

const LEVEL_CLASS = {
  high: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  moderate: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  low: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  critical: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/50',
};

export function AlertnessGuard({ input, blockingCriticalOperation }: AlertnessGuardProps) {
  const { t } = useTranslation();
  const report = useMemo(() => assessAlertness(input), [input]);

  const Icon =
    report.level === 'high'
      ? CheckCircle2
      : report.level === 'critical'
        ? AlertTriangle
        : report.window === 'low_alert'
          ? Moon
          : Brain;

  const shouldBlock = blockingCriticalOperation && report.blockCriticalOps;

  return (
    <section
      className={`rounded-lg border-2 p-3 ${LEVEL_CLASS[report.level]}`}
      data-testid="alertness-guard"
      role={shouldBlock ? 'alert' : undefined}
      aria-label={t('alertness.aria', 'Estado de alerta circadiana') as string}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
        <h3 className="text-sm font-black uppercase tracking-wide">
          {t('alertness.title', 'Alerta circadiana')}
        </h3>
        <span className="ml-auto text-2xl font-black tabular-nums" data-testid="alertness-score">
          {report.alertnessScore}
        </span>
      </div>

      <p className="text-[10px] uppercase opacity-80 mb-1">
        {t('alertness.window', 'Ventana')}: <strong>{report.window}</strong> ·{' '}
        {t('alertness.levelLabel', 'Nivel')}: <strong>{report.level}</strong>
      </p>

      {report.recommendations.length > 0 && (
        <ul className="text-[11px] mt-2 space-y-1">
          {report.recommendations.map((r, i) => (
            <li key={i} className="flex items-start gap-1">
              <span aria-hidden="true">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {shouldBlock && (
        <div
          className="mt-3 p-2 rounded bg-rose-500/20 text-xs font-bold"
          data-testid="alertness-blocked"
        >
          {t(
            'alertness.blocked',
            '⛔ NO autorizado para operación de equipos críticos en este estado.',
          )}
        </div>
      )}
    </section>
  );
}
