// Praeventio Guard — Wire UI #82: <HorometerStatusCard />
//
// Tarjeta de estado del horómetro de una máquina + barra progreso ciclo
// + acción mantención sugerida + flag bloqueo.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, AlertOctagon, Calendar } from 'lucide-react';
import {
  assessHorometerStatus,
  proposeCalendarTask,
  type MachineHorometer,
  type MaintenancePolicy,
  type MaintenanceThresholdKind,
} from '../../services/maintenance/horometerEngine.js';

interface HorometerStatusCardProps {
  horometer: MachineHorometer;
  policy: MaintenancePolicy;
  /** Horas de uso típicas diarias para proyectar la fecha. */
  avgUsageHoursPerDay?: number;
  onSchedule?: (task: ReturnType<typeof proposeCalendarTask>) => void;
}

const THRESHOLD_TONE: Record<
  MaintenanceThresholdKind | 'ok',
  { color: string; bg: string; track: string; badge: string }
> = {
  ok: {
    color: 'text-emerald-600',
    bg: 'bg-emerald-500/10',
    track: 'bg-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  warning: {
    color: 'text-amber-600',
    bg: 'bg-amber-500/10',
    track: 'bg-amber-500',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  critical: {
    color: 'text-orange-600',
    bg: 'bg-orange-500/10',
    track: 'bg-orange-500',
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  },
  mandatory: {
    color: 'text-rose-600',
    bg: 'bg-rose-500/10',
    track: 'bg-rose-500',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
};

export function HorometerStatusCard({
  horometer,
  policy,
  avgUsageHoursPerDay = 8,
  onSchedule,
}: HorometerStatusCardProps) {
  const { t } = useTranslation();
  const status = useMemo(
    () => assessHorometerStatus(horometer, policy),
    [horometer, policy],
  );
  const task = useMemo(
    () => proposeCalendarTask(status, { avgUsageHoursPerDay }),
    [status, avgUsageHoursPerDay],
  );

  const tone = status.triggeredThreshold
    ? THRESHOLD_TONE[status.triggeredThreshold.kind]
    : THRESHOLD_TONE.ok;

  const cappedPercent = Math.min(100, status.cycleProgressPercent);

  return (
    <section
      className={`rounded-2xl border border-default-token p-4 shadow-mode space-y-3 ${tone.bg}`}
      data-testid={`horometer-card-${horometer.machineId}`}
      aria-label={t('horometer.aria', 'Estado horómetro') as string}
    >
      <header className="flex items-center gap-2">
        <Wrench className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide truncate">
          {horometer.machineId}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`horometer-state-${horometer.machineId}`}
        >
          {status.triggeredThreshold?.kind ?? 'ok'}
        </span>
      </header>

      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="uppercase font-bold">{t('horometer.cycle', 'Ciclo')}</span>
          <span
            className="tabular-nums"
            data-testid={`horometer-progress-${horometer.machineId}`}
          >
            {status.hoursSinceLastMaintenance}/{policy.cycleHours}h ({cappedPercent}%)
          </span>
        </div>
        <div className="h-2 bg-surface-elevated rounded overflow-hidden">
          <div
            className={`h-full ${tone.track}`}
            style={{ width: `${cappedPercent}%` }}
            data-testid={`horometer-bar-${horometer.machineId}`}
          />
        </div>
      </div>

      <p className="text-[11px]" data-testid={`horometer-message-${horometer.machineId}`}>
        {status.message}
      </p>

      {status.mandatoryOverdue && (
        <div
          className="flex items-start gap-2 bg-rose-500/15 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px] font-bold"
          data-testid={`horometer-mandatory-${horometer.machineId}`}
        >
          <AlertOctagon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'horometer.mandatoryOverdue',
              'Mantención obligatoria vencida — se recomienda detener y completarla antes de seguir operando.',
            )}
          </span>
        </div>
      )}

      {task && (
        <div
          className="flex items-center gap-2 bg-surface rounded p-2"
          data-testid={`horometer-task-${horometer.machineId}`}
        >
          <Calendar className="w-3 h-3 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold truncate">{task.title}</p>
            <p className="text-[10px] text-secondary-token">
              {task.proposedDateIso.slice(0, 10)} · {task.priority.toUpperCase()}
            </p>
          </div>
          {onSchedule && (
            <button
              type="button"
              onClick={() => onSchedule(task)}
              data-testid={`horometer-schedule-${horometer.machineId}`}
              className="text-[10px] font-bold text-sky-600 underline"
            >
              {t('horometer.schedule', 'Agendar')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
