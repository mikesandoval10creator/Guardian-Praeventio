// Praeventio Guard — Wire UI #52: <CriticalRoleCoverageCard />
//
// Muestra cobertura de un rol crítico: titulares, sustitutos, en
// capacitación + bus factor + flag fragilidad + plan de capacitación
// sugerido.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UserCog, AlertOctagon, GraduationCap } from 'lucide-react';
import {
  buildRoleCoverage,
  suggestTrainingPlan,
  type CriticalRoleDefinition,
  type WorkerProfile,
} from '../../services/criticalRoles/criticalRolesMap.js';

interface CriticalRoleCoverageCardProps {
  role: CriticalRoleDefinition;
  workers: WorkerProfile[];
}

export function CriticalRoleCoverageCard({ role, workers }: CriticalRoleCoverageCardProps) {
  const { t } = useTranslation();
  const coverage = useMemo(() => buildRoleCoverage(role, workers), [role, workers]);
  const plan = useMemo(
    () => suggestTrainingPlan(coverage, workers),
    [coverage, workers],
  );

  return (
    <section
      className={`rounded-2xl border p-4 shadow-mode space-y-3 ${
        coverage.isFragile
          ? 'border-rose-500/30 bg-rose-500/5'
          : 'border-default-token bg-surface'
      }`}
      data-testid={`role-coverage-${role.code}`}
      aria-label={t('criticalRoles.aria', 'Cobertura rol crítico') as string}
    >
      <header className="flex items-center gap-2">
        <UserCog className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token truncate">{role.label}</h2>
        <span className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums">
          {t('criticalRoles.busFactor', 'Bus factor')}: {coverage.busFactor}
        </span>
      </header>

      {coverage.isFragile && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid={`role-fragile-${role.code}`}
        >
          <AlertOctagon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'criticalRoles.fragile',
              'Rol frágil: si pierdes una persona, no cumples el mínimo autorizado.',
            )}{' '}
            ({t('criticalRoles.min', 'Mínimo')}: {role.minimumAuthorized})
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface-elevated rounded p-2" data-testid={`role-titulars-${role.code}`}>
          <p className="text-[10px] uppercase text-secondary-token">
            {t('criticalRoles.titulars', 'Titulares')}
          </p>
          <p className="text-xl font-black tabular-nums text-emerald-600">
            {coverage.titulars.length}
          </p>
        </div>
        <div
          className="bg-surface-elevated rounded p-2"
          data-testid={`role-substitutes-${role.code}`}
        >
          <p className="text-[10px] uppercase text-secondary-token">
            {t('criticalRoles.substitutes', 'Sustitutos')}
          </p>
          <p className="text-xl font-black tabular-nums text-amber-600">
            {coverage.substitutes.length}
          </p>
        </div>
        <div
          className="bg-surface-elevated rounded p-2"
          data-testid={`role-in-training-${role.code}`}
        >
          <p className="text-[10px] uppercase text-secondary-token">
            {t('criticalRoles.inTraining', 'En capacitación')}
          </p>
          <p className="text-xl font-black tabular-nums text-sky-600">
            {coverage.inTraining.length}
          </p>
        </div>
      </div>

      {plan.recommendedCandidates.length > 0 && (
        <div data-testid={`role-plan-${role.code}`} className="bg-sky-500/5 p-2 rounded space-y-1">
          <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-sky-700 dark:text-sky-300">
            <GraduationCap className="w-3 h-3" aria-hidden="true" />
            {t('criticalRoles.planTitle', 'Plan capacitación sugerido')}
          </h3>
          <p className="text-[11px]">{plan.message}</p>
          <p className="text-[10px] text-secondary-token">
            {t('criticalRoles.estimated', 'Estimado')}: {plan.estimatedDaysToCoverage}d
          </p>
        </div>
      )}
    </section>
  );
}
