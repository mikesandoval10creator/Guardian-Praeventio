// Praeventio Guard — Bloque D Rama 1: <ReturnToWorkPanel />
//
// Self-contained task-fit assessment form over the pure-compute endpoint
// POST /api/sprint-k/:projectId/return-to-work/assess-task-fit
// (src/server/routes/returnToWork.ts, Sprint 49 §251-254), consumed via
// the previously-orphaned client hook src/hooks/useReturnToWork.ts.
//
// ADR 0012: copy speaks ONLY of operational "aptitud de tarea" and
// "derivación" — the engine works on coded restriction tags, never on
// medical diagnosis / PHI. Minimal v1 form: one active restriction +
// one task conflict → fit verdict.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, AlertTriangle } from 'lucide-react';
import { assessReturnToWorkTaskFit } from '../../hooks/useReturnToWork';
import type {
  RestrictionTag,
  TaskFitAssessment,
  WorkerRestriction,
} from '../../services/returnToWork/returnToWorkPlanner';
import { humanErrorMessage } from '../../lib/humanError';


interface ReturnToWorkPanelProps {
  projectId: string;
}

// Closed vocabulary — mirrors RESTRICTION_TAGS in the server router.
const RESTRICTION_OPTIONS: Array<{ value: RestrictionTag; label: string }> = [
  { value: 'no_lifting_above_10kg', label: 'Sin levantar sobre 10 kg' },
  { value: 'no_lifting_above_25kg', label: 'Sin levantar sobre 25 kg' },
  { value: 'no_repetitive_movement_hand', label: 'Sin movimiento repetitivo de mano' },
  { value: 'no_repetitive_movement_shoulder', label: 'Sin movimiento repetitivo de hombro' },
  { value: 'no_prolonged_standing', label: 'Sin estar de pie prolongado' },
  { value: 'no_prolonged_sitting', label: 'Sin estar sentado prolongado' },
  { value: 'no_squatting', label: 'Sin trabajo en cuclillas' },
  { value: 'no_kneeling', label: 'Sin trabajo de rodillas' },
  { value: 'no_overhead_work', label: 'Sin trabajo sobre nivel de hombros' },
  { value: 'no_height_work', label: 'Sin trabajo en altura' },
  { value: 'no_confined_spaces', label: 'Sin espacios confinados' },
  { value: 'no_extreme_temperature', label: 'Sin temperatura extrema' },
  { value: 'no_high_noise', label: 'Sin ruido alto' },
  { value: 'no_chemical_exposure', label: 'Sin exposición química' },
  { value: 'no_vibration_exposure', label: 'Sin exposición a vibración' },
  { value: 'no_uv_extreme', label: 'Sin radiación UV extrema' },
  { value: 'no_night_shift', label: 'Sin turno nocturno' },
  { value: 'no_isolated_work', label: 'Sin trabajo aislado' },
  { value: 'no_decision_under_pressure', label: 'Sin decisiones bajo presión' },
  { value: 'no_driving', label: 'Sin conducción' },
  { value: 'reduced_hours', label: 'Jornada reducida' },
  { value: 'requires_buddy', label: 'Requiere acompañante (buddy)' },
  { value: 'requires_frequent_breaks', label: 'Requiere pausas frecuentes' },
];

const SOURCE_OPTIONS: Array<{ value: WorkerRestriction['source']; label: string }> = [
  { value: 'mutual_doctor_order', label: 'Orden médica de mutualidad' },
  { value: 'company_doctor_order', label: 'Orden médica de empresa' },
  { value: 'self_reported', label: 'Autorreporte del trabajador' },
  { value: 'supervisor_observation', label: 'Observación de supervisión' },
];

const FIT_LABELS: Record<TaskFitAssessment['fit'], string> = {
  fit: 'Apto para la tarea',
  fit_with_accommodation: 'Apto con acomodaciones',
  unfit: 'No apto para esta tarea',
  requires_medical_review: 'Requiere revisión de vigencia (médico tratante)',
};

const FIT_TONES: Record<TaskFitAssessment['fit'], string> = {
  fit: 'text-emerald-600 dark:text-emerald-400',
  fit_with_accommodation: 'text-amber-600 dark:text-amber-400',
  unfit: 'text-rose-600 dark:text-rose-400',
  requires_medical_review: 'text-amber-600 dark:text-amber-400',
};

export function ReturnToWorkPanel({ projectId }: ReturnToWorkPanelProps) {
  const { t } = useTranslation();
  const [workerUid, setWorkerUid] = useState('');
  const [restrictionTag, setRestrictionTag] = useState<RestrictionTag>('no_lifting_above_10kg');
  const [source, setSource] = useState<WorkerRestriction['source']>('mutual_doctor_order');
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [taskId, setTaskId] = useState('');
  const [conflictTag, setConflictTag] = useState<RestrictionTag>('no_lifting_above_10kg');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<TaskFitAssessment | null>(null);

  const canSubmit = workerUid.trim().length > 0 && taskId.trim().length > 0 && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await assessReturnToWorkTaskFit(projectId, {
        workerRestrictions: [
          { workerUid: workerUid.trim(), tag: restrictionTag, startsAt, source },
        ],
        task: { taskId: taskId.trim(), conflictsWith: [conflictTag] },
      });
      setAssessment(res.assessment);
    } catch (err) {
      setAssessment(null);
      setError(humanErrorMessage(err instanceof Error ? err.message : 'unknown_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="return-to-work-panel"
      aria-label={t('returnToWork.panel.aria', 'Evaluación de aptitud de tarea') as string}
    >
      <header className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('returnToWork.panel.title', 'Aptitud de tarea (reintegro)')}
        </h2>
      </header>

      <p className="text-[11px] text-secondary-token">
        {t(
          'returnToWork.panel.disclaimer',
          'Evaluación operacional con restricciones codificadas — sin diagnóstico ni datos médicos (ADR 0012).',
        )}
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('returnToWork.panel.workerUid', 'ID trabajador')}
          </span>
          <input
            type="text"
            value={workerUid}
            onChange={(e) => setWorkerUid(e.target.value)}
            data-testid="return-to-work-worker"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('returnToWork.panel.workerUid', 'ID trabajador') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('returnToWork.panel.taskId', 'ID tarea')}
          </span>
          <input
            type="text"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            data-testid="return-to-work-task"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('returnToWork.panel.taskId', 'ID tarea') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('returnToWork.panel.restriction', 'Restricción vigente')}
          </span>
          <select
            value={restrictionTag}
            onChange={(e) => setRestrictionTag(e.target.value as RestrictionTag)}
            data-testid="return-to-work-restriction"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {RESTRICTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('returnToWork.panel.conflict', 'La tarea choca con')}
          </span>
          <select
            value={conflictTag}
            onChange={(e) => setConflictTag(e.target.value as RestrictionTag)}
            data-testid="return-to-work-conflict"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {RESTRICTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('returnToWork.panel.source', 'Fuente de la restricción')}
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as WorkerRestriction['source'])}
            data-testid="return-to-work-source"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('returnToWork.panel.startsAt', 'Vigente desde')}
          </span>
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            data-testid="return-to-work-starts-at"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('returnToWork.panel.startsAt', 'Vigente desde') as string}
          />
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="return-to-work-submit"
          className="col-span-2 rounded-xl bg-sky-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-2 disabled:opacity-50"
        >
          {loading
            ? t('common.loading', 'Cargando…')
            : t('returnToWork.panel.submit', 'Evaluar aptitud')}
        </button>
      </form>

      {error && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="return-to-work-error"
          role="alert"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('returnToWork.panel.error', 'No se pudo evaluar la aptitud.')} ({humanErrorMessage(error)})</span>
        </div>
      )}

      {assessment && (
        <div
          className="bg-surface-elevated rounded p-3 space-y-2"
          data-testid="return-to-work-result"
        >
          <p className={`text-sm font-black ${FIT_TONES[assessment.fit]}`}>
            {FIT_LABELS[assessment.fit]}
          </p>
          <p className="text-xs text-secondary-token">{assessment.rationale}</p>
          {assessment.violatedRestrictions.length > 0 && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400">
              {t('returnToWork.panel.violated', 'Restricciones en conflicto:')}{' '}
              {assessment.violatedRestrictions
                .map((tag) => RESTRICTION_OPTIONS.find((o) => o.value === tag)?.label ?? tag)
                .join(', ')}
            </p>
          )}
          {assessment.suggestedAccommodations.length > 0 && (
            <ul className="text-[11px] text-secondary-token list-disc pl-4">
              {assessment.suggestedAccommodations.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
