// Praeventio Guard — Wire UI #32: <PymeMaturityWizard />
//
// Wizard onboarding para PYMEs. Calcula maturity index + plan 30 días.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import {
  computeMaturity,
  buildThirtyDayPlan,
  type PymeWizardInput,
  type MaturityReport,
} from '../../services/pymeOnboarding/pymeWizard.js';

interface PymeMaturityWizardProps {
  input: PymeWizardInput;
}

const LEVEL_CLASS: Record<MaturityReport['label'], string> = {
  reactive: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  compliant: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40',
  proactive: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  systematic: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  autonomous: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
};

const LEVEL_LABEL_ES: Record<MaturityReport['label'], string> = {
  reactive: 'Nivel 1 — Reactivo',
  compliant: 'Nivel 2 — Cumple',
  proactive: 'Nivel 3 — Proactivo',
  systematic: 'Nivel 4 — Sistemático',
  autonomous: 'Nivel 5 — Autónomo',
};

export function PymeMaturityWizard({ input }: PymeMaturityWizardProps) {
  const { t } = useTranslation();
  const maturity = useMemo(() => computeMaturity(input), [input]);
  const plan = useMemo(() => buildThirtyDayPlan(maturity, input.industry), [maturity, input]);

  return (
    <section
      className="space-y-4"
      data-testid="pyme-wizard"
      aria-label={t('pyme.aria', 'Wizard de madurez PYME') as string}
    >
      {/* Maturity card */}
      <div
        className={`rounded-2xl border-2 p-4 shadow-mode ${LEVEL_CLASS[maturity.label]}`}
        data-testid="pyme-maturity-card"
      >
        <header className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide">
            {LEVEL_LABEL_ES[maturity.label]}
          </h2>
          <span className="ml-auto text-2xl font-black tabular-nums" data-testid="pyme-maturity-score">
            {maturity.score}
          </span>
        </header>

        {maturity.missingCapabilities.length > 0 && (
          <div data-testid="pyme-missing-capabilities">
            <p className="text-[10px] uppercase opacity-80 mb-1.5">
              {t('pyme.missing', 'Capacidades faltantes')}
            </p>
            <ul className="space-y-1">
              {maturity.missingCapabilities.map((cap, i) => (
                <li key={i} className="text-[11px] flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{cap}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 30-day plan */}
      <div
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
        data-testid="pyme-thirty-day-plan"
      >
        <header className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
            {t('pyme.planTitle', 'Plan 30 días')}
          </h2>
          <span className="ml-auto text-xs text-secondary-token">{plan.length}</span>
        </header>

        <ol className="space-y-2">
          {plan.map((action, i) => (
            <li
              key={i}
              data-testid={`pyme-action-day-${action.day}`}
              className="flex items-start gap-2"
            >
              <span className="text-[10px] font-bold w-10 text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0">
                D{action.day}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-primary-token leading-tight">
                  {action.title}
                </p>
                <p className="text-[10px] text-secondary-token mt-0.5 leading-snug">
                  {action.rationale}
                </p>
              </div>
              {action.requiresSpecialist && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0">
                  {t('pyme.specialistLabel', 'Especialista')}
                </span>
              )}
            </li>
          ))}
        </ol>

        {plan.every((p) => p.day === 30 || !p.requiresSpecialist) && (
          <p
            className="mt-3 text-[10px] flex items-center gap-1 text-emerald-700 dark:text-emerald-300"
            data-testid="pyme-self-service-note"
          >
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            {t('pyme.selfService', 'Todo el plan se puede ejecutar internamente.')}
          </p>
        )}
      </div>
    </section>
  );
}
