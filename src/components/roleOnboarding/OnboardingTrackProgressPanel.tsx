// Praeventio Guard — Wire UI: <OnboardingTrackProgressPanel />
//
// Visualiza el progreso de onboarding por rol consumiendo
// `roleOnboardingTracks.ts`. El componente es controlado: el caller
// le pasa progress + track, recibe `onStepCompleted` cuando el usuario
// marca un paso terminado. El motor se encarga de la idempotencia y
// el cálculo de estado.

import { useTranslation } from 'react-i18next';
import {
  GraduationCap,
  CheckCircle2,
  Circle,
  Lock,
  Play,
  Clock,
  Video,
  FileText,
  Activity,
  Award,
  Eye,
} from 'lucide-react';
import type {
  OnboardingTrack,
  OnboardingStep,
  OnboardingStepKind,
  OnboardingStatus,
  UserOnboardingProgress,
} from '../../services/roleOnboarding/roleOnboardingTracks.js';

interface OnboardingTrackProgressPanelProps {
  /** Track del rol del usuario. */
  track: OnboardingTrack;
  /** Progreso actual del usuario. */
  progress: UserOnboardingProgress;
  /** Status calculado (de `evaluateProgress(progress, track)`). */
  status: OnboardingStatus;
  /** Callback al click "Iniciar" en un step pendiente. */
  onStartStep?: (step: OnboardingStep) => void;
  /** Callback al click "Marcar completado". */
  onCompleteStep?: (step: OnboardingStep) => void;
}

const KIND_ICON: Record<OnboardingStepKind, typeof Video> = {
  video: Video,
  doc_read: FileText,
  quiz: Award,
  sandbox_task: Activity,
  live_demo: Play,
  shadow_session: Eye,
};

const KIND_LABEL: Record<OnboardingStepKind, string> = {
  video: 'Video',
  doc_read: 'Lectura',
  quiz: 'Quiz',
  sandbox_task: 'Tarea sandbox',
  live_demo: 'Demo en vivo',
  shadow_session: 'Sesión de observación',
};

export function OnboardingTrackProgressPanel({
  track,
  progress,
  status,
  onStartStep,
  onCompleteStep,
}: OnboardingTrackProgressPanelProps) {
  const { t } = useTranslation();
  const completedSet = new Set(progress.completedStepIds);

  const operationBadge = status.canOperate
    ? {
        cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
        label: t('onboarding.canOperate', 'Habilitado para operar') as string,
        Icon: CheckCircle2,
        state: 'ready',
      }
    : {
        cls: 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300',
        label: t('onboarding.blocked', `${status.blockedSteps} pasos bloqueantes pendientes`) as string,
        Icon: Lock,
        state: 'blocked',
      };

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/60 dark:bg-stone-900/40 p-4"
      data-testid="onboarding-track-panel"
      aria-label={t('onboarding.aria', 'Progreso de onboarding del rol') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <GraduationCap className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
          {t('onboarding.title', 'Onboarding')} — {track.role}
        </h2>
        <span
          data-testid="onboarding-operation-badge"
          data-state={operationBadge.state}
          className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${operationBadge.cls}`}
        >
          <operationBadge.Icon className="w-3 h-3" aria-hidden="true" />
          {operationBadge.label}
        </span>
      </header>

      {/* Overall progress */}
      <div className="mb-3" data-testid="onboarding-progress-bar">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400">
            {t('onboarding.progressLabel', 'Progreso')}
          </span>
          <span className="text-lg font-black text-stone-800 dark:text-stone-100">
            {status.completedSteps}/{status.totalSteps}{' '}
            <span className="text-xs opacity-70">({status.completedPct}%)</span>
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-stone-300/40 dark:bg-stone-700/40 overflow-hidden">
          <div
            data-testid="onboarding-progress-fill"
            style={{ width: `${status.completedPct}%` }}
            className={`h-full transition-all ${
              status.trackCompleted
                ? 'bg-emerald-500'
                : status.canOperate
                  ? 'bg-teal-500'
                  : 'bg-amber-500'
            }`}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] mt-1.5 opacity-80">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {status.remainingMinutes} {t('onboarding.minutesLeft', 'min restantes')}
          </span>
          {status.trackCompleted && (
            <span
              data-testid="onboarding-track-completed-badge"
              className="font-bold text-emerald-700 dark:text-emerald-300"
            >
              {t('onboarding.trackCompleted', 'Track completado')}
            </span>
          )}
        </div>
      </div>

      {/* Steps list */}
      <ol className="space-y-2" data-testid="onboarding-steps">
        {track.steps.map((step) => {
          const completed = completedSet.has(step.id);
          const isNext = status.nextRecommendedStepId === step.id;
          return (
            <StepRow
              key={step.id}
              step={step}
              completed={completed}
              isNext={isNext}
              onStart={onStartStep ? () => onStartStep(step) : undefined}
              onComplete={onCompleteStep ? () => onCompleteStep(step) : undefined}
            />
          );
        })}
      </ol>
    </section>
  );
}

interface StepRowProps {
  step: OnboardingStep;
  completed: boolean;
  isNext: boolean;
  onStart?: () => void;
  onComplete?: () => void;
}

function StepRow({ step, completed, isNext, onStart, onComplete }: StepRowProps) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[step.kind];
  const state = completed ? 'completed' : isNext ? 'next' : 'pending';
  const stateClass = {
    completed:
      'border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200',
    next: 'border-teal-500/50 bg-teal-500/10 text-teal-800 dark:text-teal-200 ring-1 ring-teal-500/30',
    pending:
      'border-stone-500/20 bg-stone-500/5 text-stone-700 dark:text-stone-300',
  }[state];

  return (
    <li
      data-testid={`onboarding-step-${step.id}`}
      data-state={state}
      className={`rounded-lg border p-2.5 ${stateClass}`}
    >
      <div className="flex items-start gap-2.5">
        {completed ? (
          <CheckCircle2
            className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5"
            aria-hidden="true"
            data-testid={`onboarding-step-${step.id}-icon-completed`}
          />
        ) : (
          <Circle
            className="w-5 h-5 text-stone-400 shrink-0 mt-0.5"
            aria-hidden="true"
            data-testid={`onboarding-step-${step.id}-icon-pending`}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-bold leading-tight">{step.title}</p>
            {step.blockingForOperation && !completed && (
              <span
                data-testid={`onboarding-step-${step.id}-blocking`}
                className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide font-bold opacity-80"
              >
                <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                {t('onboarding.blockingTag', 'Bloqueante')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] mt-0.5 opacity-80">
            <span className="inline-flex items-center gap-0.5">
              <Icon className="w-3 h-3" aria-hidden="true" />
              {KIND_LABEL[step.kind]}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Clock className="w-3 h-3" aria-hidden="true" />~{step.estimatedMinutes} min
            </span>
          </div>
          <p className="text-[11px] mt-0.5 opacity-75 italic">
            {step.learningOutcome}
          </p>
        </div>
        {!completed && (
          <div className="flex flex-col gap-1 shrink-0">
            {onStart && (
              <button
                type="button"
                onClick={onStart}
                data-testid={`onboarding-step-${step.id}-start`}
                className="px-2 py-1 rounded-md bg-teal-600 text-white text-[11px] font-bold hover:brightness-110"
              >
                <Play className="w-3 h-3 inline -mt-0.5 mr-0.5" aria-hidden="true" />
                {t('onboarding.startBtn', 'Iniciar')}
              </button>
            )}
            {onComplete && (
              <button
                type="button"
                onClick={onComplete}
                data-testid={`onboarding-step-${step.id}-complete`}
                className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold hover:brightness-110"
              >
                {t('onboarding.markDoneBtn', 'Marcar hecho')}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
