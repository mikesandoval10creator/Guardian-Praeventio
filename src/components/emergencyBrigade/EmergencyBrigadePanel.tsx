// Praeventio Guard — Wire UI #29: <EmergencyBrigadePanel />
//
// Panel readiness brigada emergencia: cobertura por rol + recursos
// operativos + gaps detectados.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Siren, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import {
  buildBrigadeCoverageReport,
  buildResourceReadinessReport,
  detectCoverageGaps,
  type BrigadeMember,
  type EmergencyResource,
  type CoverageRequirement,
  type BrigadeRole,
} from '../../services/emergencyBrigade/emergencyBrigadeService.js';

interface EmergencyBrigadePanelProps {
  members: BrigadeMember[];
  resources: EmergencyResource[];
  requirements: CoverageRequirement[];
}

const ROLE_LABEL: Record<BrigadeRole, string> = {
  brigade_chief: 'Jefe brigada',
  first_aid: 'Primeros auxilios',
  fire_response: 'Respuesta fuego',
  evacuation_coordinator: 'Coord. evacuación',
  communications: 'Comunicaciones',
};

export function EmergencyBrigadePanel({
  members,
  resources,
  requirements,
}: EmergencyBrigadePanelProps) {
  const { t } = useTranslation();
  const brigade = useMemo(() => buildBrigadeCoverageReport(members), [members]);
  const resourceReport = useMemo(() => buildResourceReadinessReport(resources), [resources]);
  const gaps = useMemo(
    () => detectCoverageGaps(resources, requirements),
    [resources, requirements],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="brigade-panel"
      aria-label={t('brigade.aria', 'Brigada emergencia readiness') as string}
    >
      <header className="flex items-center gap-2">
        <Siren className="w-4 h-4 text-rose-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('brigade.title', 'Brigada Emergencia')}
        </h2>
        {brigade.meetsMinimum ? (
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            data-testid="brigade-meets-minimum"
          >
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            {t('brigade.coverageOk', 'Cobertura mínima OK')}
          </span>
        ) : (
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300"
            data-testid="brigade-coverage-fail"
          >
            <AlertCircle className="w-3 h-3" aria-hidden="true" />
            {t('brigade.coverageFail', 'Sin cobertura mínima')}
          </span>
        )}
      </header>

      {/* Cobertura por rol */}
      <div>
        <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
          {t('brigade.byRole', 'Cobertura por rol')}
        </h3>
        <ul className="space-y-1 text-xs">
          {(Object.keys(brigade.byRole) as BrigadeRole[]).map((r) => (
            <li
              key={r}
              data-testid={`brigade-role-${r}`}
              className="flex items-center justify-between p-1.5 rounded bg-surface-elevated"
            >
              <span>{ROLE_LABEL[r]}</span>
              <span
                className={`font-bold tabular-nums ${
                  brigade.byRole[r] === 0 ? 'text-rose-700 dark:text-rose-300' : ''
                }`}
              >
                {brigade.byRole[r]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {brigade.expiredTrainings.length > 0 && (
        <div
          className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-xs"
          data-testid="brigade-expired-trainings"
        >
          <p className="font-bold text-amber-700 dark:text-amber-300 mb-1">
            {t('brigade.expiredTrainingsTitle', 'Capacitaciones vencidas')}
          </p>
          <ul className="space-y-0.5">
            {brigade.expiredTrainings.map((m) => (
              <li key={m.workerUid} className="text-[11px]">
                {m.workerUid} · {ROLE_LABEL[m.role]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Resource readiness */}
      <div data-testid="brigade-resources">
        <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" aria-hidden="true" />
          {t('brigade.resources', 'Recursos operativos')} ({resourceReport.operationalPercent}%)
        </h3>
        <p className="text-[11px] text-secondary-token">
          {resourceReport.operational} / {resourceReport.totalResources}{' '}
          {t('brigade.operational', 'operativos')}
        </p>
        {resourceReport.needingAttention.length > 0 && (
          <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
            {resourceReport.needingAttention.length} {t('brigade.needAttention', 'requieren atención')}
          </p>
        )}
      </div>

      {/* Coverage gaps */}
      {gaps.length > 0 && (
        <div
          className="rounded-md bg-rose-500/10 border border-rose-500/30 p-2 text-xs"
          data-testid="brigade-coverage-gaps"
        >
          <p className="font-bold text-rose-700 dark:text-rose-300 mb-1">
            {t('brigade.gapsTitle', 'Faltan recursos')}
          </p>
          <ul className="space-y-0.5">
            {gaps.map((g) => (
              <li key={g.kind} className="text-[11px] flex justify-between">
                <span>{g.kind}</span>
                <span className="tabular-nums">
                  {g.current} / {g.required} (faltan {g.shortfall})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
