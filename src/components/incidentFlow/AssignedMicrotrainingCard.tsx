// Praeventio Guard — Bloque 4.3 UI #4: <AssignedMicrotrainingCard />
//
// Worker view: muestra un microtraining asignado + boton para abrir el
// player. Cuando el worker completa la sesion, este componente postea la
// completion al endpoint del incident flow para cerrar el PDCA en su nombre.
//
// Founder directive (no XP negativo): incluso si el worker NO aprueba, el
// completion event se registra (passed=false) y el ciclo NO se cierra para
// el — la asignacion sigue abierta. La UI muestra el estado honestamente
// sin mensajes punitivos.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Award, CheckCircle2, RefreshCw } from 'lucide-react';
import {
  completeMicrotraining,
  type CompleteMicrotrainingPayload,
} from '../../hooks/useIncidentFlow';

export interface AssignedMicrotrainingCardProps {
  projectId: string;
  incidentId: string;
  assignmentId: string;
  moduleId: string;
  moduleTitle: string;
  workerUid: string;
  lessonSummary: string;
  /** Pieces of the original assignment we need to derive its node id. */
  assignment: CompleteMicrotrainingPayload['assignment'];
  /** Opens the LightningTrainingPlayer; callback receives the worker's score. */
  onLaunch?: () => Promise<{ score: number; passed: boolean; certified: boolean } | null>;
}

export function AssignedMicrotrainingCard({
  projectId,
  incidentId,
  assignmentId,
  moduleId,
  moduleTitle,
  workerUid,
  lessonSummary,
  assignment,
  onLaunch,
}: AssignedMicrotrainingCardProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [passed, setPassed] = useState(false);
  const [certified, setCertified] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleStart = async () => {
    if (!onLaunch) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const result = await onLaunch();
      if (!result) {
        setSubmitting(false);
        return;
      }
      const payload: CompleteMicrotrainingPayload = {
        incidentId,
        moduleId,
        workerUid,
        completedAtIso: new Date().toISOString(),
        score: result.score,
        passed: result.passed,
        certified: result.certified,
        assignment,
      };
      await completeMicrotraining(projectId, assignmentId, payload);
      setScore(result.score);
      setPassed(result.passed);
      setCertified(result.certified);
      setFinished(true);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article
      className="rounded-2xl border border-teal-500/30 bg-surface p-4 shadow-mode space-y-2"
      data-testid="assigned-microtraining-card"
      aria-label={t('incidentFlow.assigned.aria', 'Microcapacitacion asignada') as string}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-black uppercase tracking-wide text-primary-token">
              {moduleTitle}
            </h2>
            <p className="text-[10px] font-mono text-secondary-token">{moduleId}</p>
          </div>
        </div>
        {finished && passed && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
            data-testid="assigned-passed"
          >
            {t('incidentFlow.assigned.passed', 'Aprobado')}
          </span>
        )}
      </header>

      <p className="text-[11px] text-secondary-token leading-snug">
        {t('incidentFlow.assigned.derivedFrom', 'Derivada de la leccion:')} <em>{lessonSummary}</em>
      </p>

      {finished ? (
        <div
          className="rounded bg-surface-elevated p-2 space-y-1"
          data-testid="assigned-result"
        >
          <p className="text-xs">
            {t('incidentFlow.assigned.scoreLabel', 'Puntaje')}:{' '}
            <span className="font-black tabular-nums" data-testid="assigned-score">
              {score}
            </span>
            /100
          </p>
          {certified && (
            <p
              className="text-[11px] flex items-center gap-1 text-amber-700 dark:text-amber-300"
              data-testid="assigned-certified"
            >
              <Award className="w-3.5 h-3.5" aria-hidden="true" />
              {t('incidentFlow.assigned.certified', 'Certificacion emitida')}
            </p>
          )}
          {!passed && (
            <p
              className="text-[11px] flex items-center gap-1 text-secondary-token"
              data-testid="assigned-retry"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              {t(
                'incidentFlow.assigned.retryHelper',
                'Sin reproche — la asignacion sigue abierta para volver a intentar.',
              )}
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          data-testid="assigned-start"
          onClick={handleStart}
          disabled={submitting || !onLaunch}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-bold bg-teal-600 text-white disabled:opacity-40 hover:bg-teal-700"
        >
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          {submitting
            ? t('incidentFlow.assigned.running', 'Iniciando...')
            : t('incidentFlow.assigned.start', 'Hacer microcapacitacion')}
        </button>
      )}

      {errorMsg && (
        <div
          className="text-[11px] rounded bg-rose-500/10 border border-rose-500/30 px-2 py-1.5 text-rose-700 dark:text-rose-300"
          data-testid="assigned-error"
          role="alert"
        >
          {errorMsg}
        </div>
      )}
    </article>
  );
}
