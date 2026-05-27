// Praeventio Guard — Bloque 4.1: <MaintenanceTaskList />
//
// Lista de tareas activas de mantenimiento preventivo para un equipo.
// Se obtiene via GET /horometro/equipment/:eqId/maintenance-tasks.
// La UI ordena por dueAtIso ascendente (mas urgentes primero) y agrupa
// por severidad. Cada tarea expone un boton "Cerrar" que abre el
// MaintenanceCompleteForm (modal o navegacion, controlado por el parent).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wrench,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import {
  listMaintenanceTasks,
  type ListMaintenanceTasksResponse,
} from '../../hooks/useHorometro';
import type {
  MaintenanceTask,
} from '../../services/maintenance/maintenanceScheduler';

const TEAL = '#4db6ac';

export interface MaintenanceTaskListProps {
  projectId: string;
  equipmentId: string;
  /** Permite al parent abrir el formulario de cierre. */
  onSelectTask?: (task: MaintenanceTask) => void;
  /** Inyectable para tests. */
  load?: typeof listMaintenanceTasks;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: ListMaintenanceTasksResponse }
  | { kind: 'error'; message: string };

const SEVERITY_STYLE: Record<MaintenanceTask['severity'], { bg: string; text: string; chip: string }> = {
  info: {
    bg: 'bg-zinc-900 border-white/10',
    text: 'text-zinc-200',
    chip: 'bg-zinc-700 text-zinc-200',
  },
  low: {
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    text: 'text-emerald-100',
    chip: 'bg-emerald-500/40 text-emerald-100',
  },
  medium: {
    bg: 'bg-amber-500/10 border-amber-500/30',
    text: 'text-amber-100',
    chip: 'bg-amber-500/40 text-amber-100',
  },
  high: {
    bg: 'bg-orange-500/10 border-orange-500/40',
    text: 'text-orange-100',
    chip: 'bg-orange-500/50 text-orange-100',
  },
  critical: {
    bg: 'bg-rose-500/15 border-rose-500/40',
    text: 'text-rose-100',
    chip: 'bg-rose-500/60 text-white',
  },
};

export function MaintenanceTaskList({
  projectId,
  equipmentId,
  onSelectTask,
  load,
}: MaintenanceTaskListProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    const fn = load ?? listMaintenanceTasks;
    fn(projectId, equipmentId)
      .then((data) => {
        if (!cancelled) setState({ kind: 'loaded', data });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({ kind: 'error', message: err.message ?? 'load_failed' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, equipmentId, load]);

  if (state.kind === 'loading') {
    return (
      <section
        className="flex flex-col items-center justify-center py-12 gap-3"
        data-testid="maintenance-task-list-loading"
      >
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: TEAL }} aria-hidden="true" />
        <p className="text-xs uppercase tracking-widest text-zinc-400">
          {t('maintenance.loading', 'Cargando tareas…')}
        </p>
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section
        className="m-4 p-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-rose-200 text-sm space-y-2"
        data-testid="maintenance-task-list-error"
      >
        <div className="flex items-center gap-2 font-bold uppercase tracking-widest text-xs">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          {t('maintenance.errorTitle', 'No pudimos cargar las tareas')}
        </div>
        <p className="text-xs">{state.message}</p>
      </section>
    );
  }

  const { tasks, currentHours } = state.data;
  // Sort by dueAtIso ascending (most urgent first).
  const sorted = [...tasks].sort((a, b) => a.dueAtIso.localeCompare(b.dueAtIso));

  return (
    <section
      className="p-4 space-y-3"
      data-testid={`maintenance-task-list-${equipmentId}`}
    >
      <header
        className="p-3 rounded-2xl border border-white/10 bg-zinc-900 flex items-center justify-between"
        style={{ borderColor: `${TEAL}44` }}
      >
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4" style={{ color: TEAL }} aria-hidden="true" />
          <h2
            className="text-sm font-black text-white uppercase tracking-tight"
            data-testid="maintenance-task-list-title"
          >
            {t('maintenance.listTitle', 'Tareas de mantencion')}
          </h2>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-zinc-400">
            {t('maintenance.currentHours', 'Horas actuales')}
          </p>
          <p
            className="text-sm font-mono font-bold"
            data-testid="maintenance-current-hours"
          >
            {currentHours} h
          </p>
        </div>
      </header>

      {sorted.length === 0 && (
        <div
          className="p-6 rounded-2xl border border-white/10 bg-zinc-900 text-center text-zinc-400 text-sm flex flex-col items-center gap-2"
          data-testid="maintenance-task-list-empty"
        >
          <CheckCircle2 className="w-8 h-8 text-emerald-400" aria-hidden="true" />
          <p>{t('maintenance.empty', 'Sin tareas pendientes.')}</p>
        </div>
      )}

      {sorted.map((task) => {
        const style = SEVERITY_STYLE[task.severity];
        return (
          <article
            key={task.id}
            data-testid={`maintenance-task-${task.id}`}
            className={`p-4 rounded-2xl border space-y-2 ${style.bg}`}
          >
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold ${style.text} truncate`}>
                  {t(
                    'maintenance.taskTitle',
                    'Ciclo {{cycle}}h · multiplo {{multi}}',
                    { cycle: task.thresholdHours, multi: task.multiplier } as Record<string, number>,
                  )}
                </p>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                  {task.equipmentType}
                </p>
              </div>
              <span
                className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${style.chip}`}
                data-testid={`maintenance-task-${task.id}-severity`}
              >
                {task.severity}
              </span>
            </header>
            <p className="text-xs text-zinc-300 flex items-center gap-1.5">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {t('maintenance.dueAt', 'Vence')}: {task.dueAtIso.slice(0, 16).replace('T', ' ')}
            </p>
            <p className="text-[11px] text-zinc-400">
              {t('maintenance.triggeredAt', 'Gatillada a {{h}}h', { h: task.triggeredAtHours } as Record<string, number>)}
              {' · '}
              {t('maintenance.statusLabel', 'Estado')}: {task.status}
            </p>
            {onSelectTask && (
              <button
                type="button"
                onClick={() => onSelectTask(task)}
                data-testid={`maintenance-task-${task.id}-complete`}
                className="mt-2 w-full py-2 rounded-xl bg-teal-500 text-zinc-950 text-xs font-bold uppercase tracking-widest hover:bg-teal-400"
              >
                {t('maintenance.completeCta', 'Cerrar tarea con firma')}
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
