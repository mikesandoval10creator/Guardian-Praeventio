// Praeventio Guard — Wire UI #30: <ApprenticeshipBoard />
//
// Board del programa de aprendices: nivel de autorización por tarea +
// candidatos a subir de nivel.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap, Eye, UserCheck, Award, ArrowUp } from 'lucide-react';
import {
  proposeLevelUp,
  type ApprenticeProfile,
  type TaskExecutionLog,
  type AuthorizationLevel,
} from '../../services/apprenticeship/apprenticeshipProgressService.js';

interface ApprenticeshipBoardProps {
  apprentice: ApprenticeProfile;
  executions: TaskExecutionLog[];
  onPromoteLevel?: (taskId: string, toLevel: AuthorizationLevel) => void;
}

const LEVEL_ICON: Record<AuthorizationLevel, typeof Eye> = {
  observer: Eye,
  supervised: UserCheck,
  autonomous: Award,
};

const LEVEL_CLASS: Record<AuthorizationLevel, string> = {
  observer: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  supervised: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  autonomous: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

const LEVEL_LABEL: Record<AuthorizationLevel, string> = {
  observer: 'Observador',
  supervised: 'Supervisado',
  autonomous: 'Autónomo',
};

export function ApprenticeshipBoard({
  apprentice,
  executions,
  onPromoteLevel,
}: ApprenticeshipBoardProps) {
  const { t } = useTranslation();

  const tasks = useMemo(
    () => Object.entries(apprentice.taskAuthorizations) as Array<[string, AuthorizationLevel]>,
    [apprentice],
  );

  const proposals = useMemo(
    () =>
      tasks
        .map(([taskId]) => proposeLevelUp(apprentice, taskId, executions))
        .filter((p): p is NonNullable<typeof p> => p !== null),
    [tasks, apprentice, executions],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`apprentice-board-${apprentice.workerUid}`}
      aria-label={t('apprentice.aria', 'Programa aprendizaje') as string}
    >
      <header className="flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('apprentice.title', 'Programa Aprendiz')}
        </h2>
        <span className="ml-auto text-xs text-secondary-token">
          {t('apprentice.mentorLabel', 'Mentor:')} <strong>{apprentice.mentorUid}</strong>
        </span>
      </header>

      <ul className="space-y-2">
        {tasks.map(([taskId, level]) => {
          const Icon = LEVEL_ICON[level];
          const proposal = proposals.find((p) => p.taskId === taskId);
          return (
            <li
              key={taskId}
              data-testid={`apprentice-task-${taskId}`}
              className="rounded-lg border border-default-token bg-surface-elevated p-2.5"
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="text-xs font-bold flex-1 truncate">{taskId}</span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${LEVEL_CLASS[level]}`}
                >
                  {LEVEL_LABEL[level]}
                </span>
              </div>
              {proposal && (
                <p className="text-[10px] text-secondary-token mb-1">{proposal.rationale}</p>
              )}
              {proposal?.ready && onPromoteLevel && (
                <button
                  type="button"
                  onClick={() => onPromoteLevel(taskId, proposal.toLevel)}
                  data-testid={`apprentice-promote-${taskId}`}
                  className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1 underline"
                >
                  <ArrowUp className="w-3 h-3" aria-hidden="true" />
                  {t('apprentice.promoteTo', 'Promover a {{level}}', {
                    level: LEVEL_LABEL[proposal.toLevel],
                  }).replace('{{level}}', LEVEL_LABEL[proposal.toLevel])}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {tasks.length === 0 && (
        <p className="text-xs text-secondary-token italic text-center">
          {t('apprentice.noTasks', 'Sin tareas asignadas al aprendiz todavía.')}
        </p>
      )}
    </section>
  );
}
