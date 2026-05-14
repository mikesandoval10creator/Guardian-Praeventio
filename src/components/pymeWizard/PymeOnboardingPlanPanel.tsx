// Praeventio Guard — Wire UI: <PymeOnboardingPlanPanel />
//
// Visualiza el plan generado por `buildOnboardingPlan()` del motor
// `pymeOnboardingWizard.ts` (§104-105). Permite al fundador / responsable
// ver el quick-path required (<30 min), módulos a setupear, notas
// regulatorias, y marcar pasos completados para tracking de avance.

import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  CheckCircle2,
  Circle,
  Clock,
  Building2,
  FileText,
  Users,
  GraduationCap,
  Settings2,
  Eye,
  AlertOctagon,
  Scale,
  Lock,
} from 'lucide-react';
import type {
  OnboardingPlan,
  OnboardingStep,
  StepKind,
} from '../../services/pymeWizard/pymeOnboardingWizard.js';

interface PymeOnboardingPlanPanelProps {
  plan: OnboardingPlan;
  /** Ids ya marcados como completados (caller maneja persistencia). */
  completedStepIds?: string[];
  /** Callback al marcar/desmarcar un paso. */
  onToggleStep?: (step: OnboardingStep, willBeCompleted: boolean) => void;
}

const KIND_ICON: Record<StepKind, typeof FileText> = {
  profile: Building2,
  document: FileText,
  committee: Users,
  training: GraduationCap,
  module_setup: Settings2,
  review: Eye,
};

const KIND_LABEL: Record<StepKind, string> = {
  profile: 'Perfil',
  document: 'Documento',
  committee: 'Comité',
  training: 'Capacitación',
  module_setup: 'Módulo',
  review: 'Revisión',
};

export function PymeOnboardingPlanPanel({
  plan,
  completedStepIds = [],
  onToggleStep,
}: PymeOnboardingPlanPanelProps) {
  const { t } = useTranslation();
  const completedSet = new Set(completedStepIds);
  const criticalSet = new Set(plan.criticalPath);

  const requiredSteps = plan.steps.filter((s) => s.required);
  const optionalSteps = plan.steps.filter((s) => !s.required);
  const completedRequiredCount = requiredSteps.filter((s) =>
    completedSet.has(s.id),
  ).length;
  const completedRequiredPct =
    requiredSteps.length === 0
      ? 100
      : Math.round((completedRequiredCount / requiredSteps.length) * 100);

  const quickPathOk = plan.totalEstimatedMinutes <= 30;

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      data-testid="pyme-plan-panel"
      aria-label={
        t('pymePlan.aria', 'Plan de onboarding rápido para PYME') as string
      }
    >
      <header className="flex items-start gap-2 mb-3">
        <Sparkles
          className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
            {t('pymePlan.title', 'Plan PYME quick-start')}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] opacity-80">
            <span className="inline-flex items-center gap-0.5">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {t('pymePlan.requiredTime', 'Requerido')}: ~{plan.totalEstimatedMinutes} min
            </span>
            <span className="inline-flex items-center gap-0.5 opacity-60">
              + {plan.optionalSetupMinutes} min opcionales
            </span>
          </div>
        </div>
        <span
          data-testid="pyme-plan-quickpath-badge"
          data-state={quickPathOk ? 'ok' : 'over'}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
            quickPathOk
              ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300'
          }`}
        >
          {quickPathOk
            ? t('pymePlan.under30', 'Quick-path ≤30min')
            : t('pymePlan.over30', '>30min — divide')}
        </span>
      </header>

      {/* Progress bar (required only) */}
      <div className="mb-3" data-testid="pyme-plan-progress">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400">
            {t('pymePlan.requiredProgress', 'Avance requerido')}
          </span>
          <span className="text-sm font-black text-stone-800 dark:text-stone-100">
            {completedRequiredCount}/{requiredSteps.length} ({completedRequiredPct}%)
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-stone-300/40 dark:bg-stone-700/40 overflow-hidden">
          <div
            data-testid="pyme-plan-progress-fill"
            style={{ width: `${completedRequiredPct}%` }}
            className="h-full bg-teal-500 transition-all"
          />
        </div>
      </div>

      {/* Required steps */}
      <div className="mb-3" data-testid="pyme-plan-required-steps">
        <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5">
          {t('pymePlan.requiredLabel', 'Paso requerido')}
        </p>
        <ul className="space-y-1.5">
          {requiredSteps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              completed={completedSet.has(step.id)}
              critical={criticalSet.has(step.id)}
              onToggle={
                onToggleStep
                  ? () => onToggleStep(step, !completedSet.has(step.id))
                  : undefined
              }
            />
          ))}
        </ul>
      </div>

      {/* Optional steps */}
      {optionalSteps.length > 0 && (
        <div className="mb-3" data-testid="pyme-plan-optional-steps">
          <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5">
            {t('pymePlan.optionalLabel', 'Opcional (post-quick-start)')}
          </p>
          <ul className="space-y-1.5">
            {optionalSteps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                completed={completedSet.has(step.id)}
                critical={false}
                onToggle={
                  onToggleStep
                    ? () => onToggleStep(step, !completedSet.has(step.id))
                    : undefined
                }
              />
            ))}
          </ul>
        </div>
      )}

      {/* Recommended modules */}
      {plan.recommendedModules.length > 0 && (
        <div
          className="rounded-md border border-teal-500/30 bg-teal-500/5 p-2.5 mb-3"
          data-testid="pyme-plan-recommended-modules"
        >
          <p className="text-[10px] uppercase tracking-wide font-bold text-teal-700 dark:text-teal-300 mb-1 flex items-center gap-1">
            <Settings2 className="w-3 h-3" aria-hidden="true" />
            {t('pymePlan.modulesLabel', 'Módulos recomendados')}
          </p>
          <div className="flex flex-wrap gap-1">
            {plan.recommendedModules.map((m) => (
              <span
                key={m}
                data-testid={`pyme-plan-module-${m}`}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-teal-500/15 border border-teal-500/40 text-[10px] font-mono text-teal-700 dark:text-teal-300"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Regulatory notes */}
      {plan.regulatoryNotes.length > 0 && (
        <div
          className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5"
          data-testid="pyme-plan-regulatory-notes"
        >
          <p className="text-[10px] uppercase tracking-wide font-bold text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1">
            <Scale className="w-3 h-3" aria-hidden="true" />
            {t('pymePlan.regulatoryLabel', 'Notas regulatorias')}
          </p>
          <ul className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug space-y-0.5">
            {plan.regulatoryNotes.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

interface StepRowProps {
  step: OnboardingStep;
  completed: boolean;
  critical: boolean;
  onToggle?: () => void;
}

function StepRow({ step, completed, critical, onToggle }: StepRowProps) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[step.kind];
  const state = completed ? 'completed' : 'pending';
  const stateClass = completed
    ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200'
    : critical
      ? 'border-rose-500/40 bg-rose-500/5 text-stone-800 dark:text-stone-100'
      : 'border-stone-500/20 bg-stone-500/5 text-stone-700 dark:text-stone-200';

  return (
    <li
      data-testid={`pyme-plan-step-${step.id}`}
      data-state={state}
      data-critical={critical ? 'true' : 'false'}
      className={`rounded-md border p-2 ${stateClass}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={!onToggle}
          data-testid={`pyme-plan-step-${step.id}-toggle`}
          aria-pressed={completed}
          className={`p-0.5 rounded-full ${onToggle ? 'cursor-pointer' : 'cursor-default'}`}
        >
          {completed ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
          ) : (
            <Circle className="w-5 h-5 text-stone-400" aria-hidden="true" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-bold leading-tight">{step.label}</p>
            {critical && !completed && (
              <span
                data-testid={`pyme-plan-step-${step.id}-critical-tag`}
                className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide font-bold opacity-80 text-rose-700 dark:text-rose-300"
              >
                <AlertOctagon className="w-2.5 h-2.5" aria-hidden="true" />
                {t('pymePlan.criticalTag', 'Crítico')}
              </span>
            )}
            {step.required && !critical && (
              <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide font-bold opacity-70">
                <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                {t('pymePlan.requiredTag', 'Requerido')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] mt-0.5 opacity-75">
            <span className="inline-flex items-center gap-0.5">
              <Icon className="w-3 h-3" aria-hidden="true" />
              {KIND_LABEL[step.kind]}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Clock className="w-3 h-3" aria-hidden="true" />~{step.estimatedMinutes} min
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}
