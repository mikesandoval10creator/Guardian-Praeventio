// Praeventio Guard — Fase F.16 page wrapper.
//
// Score de Preparación del Trabajador. Asistente NO BLOQUEANTE: la
// página MUESTRA el score + recomendaciones; el supervisor decide.
// Directiva 2 del usuario explícita — esta vista nunca debe gate-ar
// ninguna acción operativa.
//
// La página:
//   1. Permite seleccionar un trabajador (autocomplete sobre
//      `projects/{pid}/workers`) + opcionalmente una tarea.
//   2. Llama `useWorkerReadiness(projectId, workerUid, { taskId })`.
//   3. Renderiza:
//      - Score grande con color semántico (green ≥80, amber 60-79, rose <60)
//      - 4 sub-scores en barras (training/epp/fatigue/history)
//      - Blockers (gaps explícitos) en card rose
//      - Recommendations en card teal
//      - Banner ámbar si score < 60: "Requiere atención del supervisor
//        antes de proceder" — informativo, NO bloqueante.
//
// El servicio devuelve 6 sub-scores (trainings/epp/medical/documents/
// experience/fatigue). El plan F.16 pide 4 barras (training/epp/fatigue/
// history); mapeamos:
//   - training = trainings
//   - epp = epp
//   - fatigue = fatigue
//   - history = medical + documents + experience (combinados; los tres
//     reflejan "historial del trabajador" en sentido amplio: aptitud
//     médica vigente, documentos firmados acumulados, experiencia
//     histórica en la categoría). Esto preserva el peso original sin
//     perder señales.

import { useMemo, useState } from 'react';
import { humanErrorMessage } from '../lib/humanError';
import { useTranslation } from 'react-i18next';
import { UserCheck, WifiOff, AlertTriangle, ListChecks, Lightbulb } from 'lucide-react';
import { where } from 'firebase/firestore';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useWorkerReadiness } from '../hooks/useWorkerReadiness';
import type { Worker } from '../types';
import { WorkerReadinessCard } from '../components/workerReadiness/WorkerReadinessCard';
import type { ReadinessReport } from '../services/workerReadiness/readinessScore';

interface TaskLite {
  id: string;
  title?: string;
  name?: string;
  category?: string;
}

/**
 * Pick semantic color tokens by score band. Matches the legend in the
 * page header so the badge color, the progress bar, and the banner all
 * stay in sync.
 *   - green ≥ 80  → ready / minor gaps
 *   - amber 60-79 → attention requested (banner triggers)
 *   - rose  < 60  → major/critical gaps (banner triggers below 60)
 */
function colorForScore(score: number): {
  text: string;
  bg: string;
  border: string;
  bar: string;
} {
  if (score >= 80) {
    return {
      text: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      bar: 'bg-emerald-500',
    };
  }
  if (score >= 60) {
    return {
      text: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      bar: 'bg-amber-500',
    };
  }
  return {
    text: 'text-rose-500',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/20',
    bar: 'bg-rose-500',
  };
}

/**
 * Convert a sub-score (0..max) into a percentage bar width. The service
 * already scales sub-scores to a fixed max per dimension (trainings: 25,
 * epp: 20, fatigue: 15, medical+documents+experience together: 40), so
 * we pass the max in explicitly to avoid lying about progress.
 */
function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

interface SubScoreBarProps {
  label: string;
  value: number;
  max: number;
  testId: string;
}

function SubScoreBar({ label, value, max, testId }: SubScoreBarProps) {
  const percent = pct(value, max);
  const color = colorForScore(percent);
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-primary-token">{label}</span>
        <span className={`font-bold ${color.text}`}>
          {value}/{max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-200/40 dark:bg-zinc-800 overflow-hidden">
        <div
          className={`h-full ${color.bar} transition-all duration-300`}
          style={{ width: `${percent}%` }}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
        />
      </div>
    </div>
  );
}

export function WorkerReadiness() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [selectedWorkerUid, setSelectedWorkerUid] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workerQuery, setWorkerQuery] = useState('');

  // Worker autocomplete data — read live from the same collection the
  // Workers page uses (`projects/{pid}/workers`). When no project is
  // selected the hook returns [] and the page falls into the empty
  // state below.
  const { data: workers } = useFirestoreCollection<Worker>(
    projectId ? `projects/${projectId}/workers` : null,
  );

  // Tasks for the optional selector — top-level `tasks` filtered by
  // projectId via a Firestore `where` clause. Per `firestore.rules` line
  // 774 (`match /tasks/{taskId}`), reads are gated by
  // `isProjectMember(resource.data.projectId)`, so an unconstrained
  // listener on the top-level `tasks` collection would request docs
  // the caller can't read and return permission-denied — leaving the
  // task selector silently empty.
  //
  // Codex PR #315 P2: scope server-side by projectId so the query only
  // returns docs the caller is authorized to read. The hook's stable
  // identity (constraints serialized via JSON.stringify) means we only
  // need to gate on `projectId` for the path itself.
  const taskConstraints = useMemo(
    () => (projectId ? [where('projectId', '==', projectId)] : []),
    [projectId],
  );
  const { data: tasks } = useFirestoreCollection<TaskLite>(
    projectId ? 'tasks' : null,
    taskConstraints,
  );

  const filteredWorkers = useMemo(() => {
    const q = workerQuery.trim().toLowerCase();
    if (!q) return workers.slice(0, 15);
    return workers
      .filter((w) =>
        ((w.name ?? '') + ' ' + (w.email ?? '') + ' ' + (w.role ?? ''))
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 15);
  }, [workers, workerQuery]);

  const tasksForProject = useMemo(() => {
    if (!projectId) return [];
    // Server-side `where` already gates by projectId, but useFirestoreCollection
    // merges in pendingSync optimistic items that may not yet have projectId
    // set — defensive client-side filter preserves cross-project safety.
    return tasks.filter(
      (task) =>
        (task as unknown as { projectId?: string }).projectId === projectId,
    );
  }, [tasks, projectId]);

  const { data, loading, error } = useWorkerReadiness(
    projectId,
    selectedWorkerUid,
    selectedTaskId ? { taskId: selectedTaskId } : undefined,
  );

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="worker-readiness-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <UserCheck className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('workerReadiness.page.title', 'Preparación del Trabajador')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'workerReadiness.page.selectProject',
              'Selecciona un proyecto para evaluar la preparación de un trabajador.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="worker-readiness-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <UserCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('workerReadiness.page.title', 'Preparación del Trabajador')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'workerReadiness.page.subtitle',
              'Asistente no-bloqueante. El supervisor decide con criterio.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="worker-readiness-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <section
        className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
        data-testid="worker-readiness-form"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-secondary-token uppercase tracking-wide">
              {t('workerReadiness.form.worker', 'Trabajador')}
            </span>
            <input
              type="text"
              value={workerQuery}
              onChange={(e) => setWorkerQuery(e.target.value)}
              placeholder={t(
                'workerReadiness.form.workerPlaceholder',
                'Buscar por nombre, email o rol…',
              )}
              className="rounded-lg border border-default-token bg-canvas px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              data-testid="worker-readiness-search"
            />
            <select
              value={selectedWorkerUid ?? ''}
              onChange={(e) =>
                setSelectedWorkerUid(e.target.value || null)
              }
              className="rounded-lg border border-default-token bg-canvas px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              data-testid="worker-readiness-select"
            >
              <option value="">
                {t('workerReadiness.form.selectWorker', '— Selecciona un trabajador —')}
              </option>
              {filteredWorkers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name || w.email || w.id}
                  {w.role ? ` · ${w.role}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-secondary-token uppercase tracking-wide">
              {t('workerReadiness.form.task', 'Tarea (opcional)')}
            </span>
            <select
              value={selectedTaskId ?? ''}
              onChange={(e) => setSelectedTaskId(e.target.value || null)}
              className="rounded-lg border border-default-token bg-canvas px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/40 mt-auto"
              data-testid="worker-readiness-task-select"
            >
              <option value="">
                {t(
                  'workerReadiness.form.selectTask',
                  '— Sin tarea específica (baseline) —',
                )}
              </option>
              {tasksForProject.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title ||
                    task.name ||
                    task.id}
                  {task.category ? ` · ${task.category}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {!selectedWorkerUid && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center text-sm text-secondary-token"
          data-testid="worker-readiness-empty"
        >
          {t(
            'workerReadiness.empty',
            'Selecciona un trabajador para ver su score de preparación.',
          )}
        </div>
      )}

      {selectedWorkerUid && loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="worker-readiness-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {selectedWorkerUid && error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="worker-readiness-error"
          role="alert"
        >
          {t(
            'workerReadiness.error',
            'No se pudo calcular el score: {{msg}}',
            { msg: humanErrorMessage(error) },
          )}
        </div>
      )}

      {selectedWorkerUid && !loading && !error && data?.report && (
        <ReportView report={data.report} />
      )}
    </div>
  );
}

interface ReportViewProps {
  report: ReadinessReport;
}

function ReportView({ report }: ReportViewProps) {
  const { t } = useTranslation();
  const color = colorForScore(report.score);
  const showAttentionBanner = report.score < 60;

  // Map 6 sub-scores → 4 bars per F.16 plan. `history` aggregates
  // medical + documents + experience (max 15 + 10 + 15 = 40). The other
  // three pass through 1:1. Combined-bar maxes:
  //   trainings: 25, epp: 20, fatigue: 15, history: 40 → total 100.
  const historyValue =
    report.subScores.medical +
    report.subScores.documents +
    report.subScores.experience;

  // The service classifies blockers as gaps whose `weight` >= 10
  // (medical_aptitude expired/missing, fatigue high/critical, missing
  // training/EPP for tasks with few requirements). Anything below is
  // a soft recommendation. The page surfaces both lists explicitly so
  // the supervisor can see the line.
  const blockers = report.gaps.filter((g) => g.weight >= 10);

  return (
    <div className="space-y-4" data-testid="worker-readiness-report">
      {/* Big overall score */}
      <section
        className={`rounded-2xl border ${color.border} ${color.bg} p-6 flex items-center gap-6`}
        data-testid="worker-readiness-overall"
      >
        <div className="flex flex-col items-center justify-center">
          <span
            className={`text-5xl font-black tracking-tight ${color.text}`}
            data-testid="worker-readiness-score-value"
          >
            {report.score}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
            {t('workerReadiness.score.outOf', 'de 100')}
          </span>
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-secondary-token">
            {t('workerReadiness.score.level', 'Nivel')}
          </p>
          <p
            className={`text-lg font-black ${color.text}`}
            data-testid="worker-readiness-level"
          >
            {report.level === 'ready' &&
              t('workerReadiness.level.ready', 'Preparado')}
            {report.level === 'minor_gaps' &&
              t('workerReadiness.level.minor_gaps', 'Brechas menores')}
            {report.level === 'major_gaps' &&
              t('workerReadiness.level.major_gaps', 'Brechas mayores')}
            {report.level === 'critical_gaps' &&
              t('workerReadiness.level.critical_gaps', 'Brechas críticas')}
          </p>
          <p className="text-xs text-secondary-token mt-1">
            {t('workerReadiness.score.category', 'Categoría de tarea: {{cat}}', {
              cat: report.taskCategory,
            })}
          </p>
        </div>
      </section>

      <WorkerReadinessCard report={report} />

      {/* Non-blocking attention banner — only visible when score < 60.
          Uses text-amber-500 per the F.16 brief; NOT a blocker — the
          page never gates any action on this. */}
      {showAttentionBanner && (
        <div
          className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3"
          data-testid="worker-readiness-attention-banner"
          role="status"
        >
          <AlertTriangle
            className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-bold text-amber-500">
              {t(
                'workerReadiness.attention.title',
                'Requiere atención del supervisor antes de proceder',
              )}
            </p>
            <p className="text-xs text-secondary-token mt-1">
              {t(
                'workerReadiness.attention.subtitle',
                'Esto es informativo. El supervisor decide con criterio basado en el contexto operativo. La página no bloquea ninguna acción.',
              )}
            </p>
          </div>
        </div>
      )}

      {/* 4 sub-score bars */}
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
        data-testid="worker-readiness-subscores"
      >
        <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-token">
          {t('workerReadiness.subscores.title', 'Detalle por dimensión')}
        </h2>
        <SubScoreBar
          label={t('workerReadiness.bar.training', 'Capacitación')}
          value={report.subScores.trainings}
          max={25}
          testId="worker-readiness-bar-training"
        />
        <SubScoreBar
          label={t('workerReadiness.bar.epp', 'EPP vigente')}
          value={report.subScores.epp}
          max={20}
          testId="worker-readiness-bar-epp"
        />
        <SubScoreBar
          label={t('workerReadiness.bar.fatigue', 'Fatiga')}
          value={report.subScores.fatigue}
          max={15}
          testId="worker-readiness-bar-fatigue"
        />
        <SubScoreBar
          label={t(
            'workerReadiness.bar.history',
            'Historial (aptitud médica + documentos firmados + experiencia)',
          )}
          value={historyValue}
          max={40}
          testId="worker-readiness-bar-history"
        />
      </section>

      {/* Blockers — gaps explícitos. Rose card. */}
      {blockers.length > 0 && (
        <section
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-2"
          data-testid="worker-readiness-blockers"
        >
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-rose-500">
            <ListChecks className="w-4 h-4" aria-hidden="true" />
            {t('workerReadiness.blockers.title', 'Brechas explícitas')}
          </h2>
          <ul className="space-y-1.5">
            {blockers.map((gap, i) => (
              <li
                key={`${gap.kind}-${i}`}
                className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2"
              >
                <span className="text-rose-500 mt-0.5">•</span>
                <span>{gap.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recommendations — teal card. */}
      {report.recommendations.length > 0 && (
        <section
          className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4 space-y-2"
          data-testid="worker-readiness-recommendations"
        >
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-teal-500">
            <Lightbulb className="w-4 h-4" aria-hidden="true" />
            {t('workerReadiness.recommendations.title', 'Acciones sugeridas')}
          </h2>
          <ul className="space-y-1.5">
            {report.recommendations.map((rec, i) => (
              <li
                key={i}
                className="text-sm text-teal-600 dark:text-teal-400 flex items-start gap-2"
              >
                <span className="text-teal-500 mt-0.5">→</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default WorkerReadiness;
