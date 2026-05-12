// Praeventio Guard — Wire UI #27: <DrillsCompliancePanel />
//
// Calendario de simulacros del proyecto con días hasta el próximo +
// flag overdue. DS 132 exige semestral evacuación/incendio.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Calendar, CheckCircle2 } from 'lucide-react';
import {
  buildDrillComplianceReport,
  type DrillResult,
  type DrillKind,
} from '../../services/drillsManager/drillsManager.js';

interface DrillsCompliancePanelProps {
  history: DrillResult[];
  onScheduleClick?: (kind: DrillKind) => void;
}

const KIND_LABEL: Record<DrillKind, string> = {
  evacuation: 'Evacuación',
  fire: 'Incendio',
  spill_chemical: 'Derrame químico',
  first_aid: 'Primeros auxilios',
  rescue_confined: 'Rescate confinado',
  rescue_height: 'Rescate altura',
  gas_leak: 'Fuga gas',
  earthquake: 'Sismo',
};

export function DrillsCompliancePanel({
  history,
  onScheduleClick,
}: DrillsCompliancePanelProps) {
  const { t } = useTranslation();
  const report = useMemo(() => buildDrillComplianceReport(history), [history]);

  const overdue = report.filter((r) => r.isOverdue);
  const upcoming = report.filter((r) => !r.isOverdue);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="drills-compliance-panel"
      aria-label={t('drills.aria', 'Cumplimiento simulacros') as string}
    >
      <header className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-orange-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('drills.title', 'Simulacros')}
        </h2>
        {overdue.length > 0 && (
          <span
            className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300"
            data-testid="drills-overdue-badge"
          >
            {overdue.length} {t('drills.overdueLabel', 'atrasados')}
          </span>
        )}
      </header>

      {overdue.length > 0 && (
        <div data-testid="drills-overdue">
          <h3 className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-1.5">
            {t('drills.overdueHeader', 'Atrasados')}
          </h3>
          <ul className="space-y-1">
            {overdue.map((r) => (
              <li
                key={r.kind}
                data-testid={`drill-overdue-${r.kind}`}
                className="flex items-center gap-2 text-xs p-2 rounded bg-rose-500/10"
              >
                <Calendar className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="flex-1 font-bold">{KIND_LABEL[r.kind]}</span>
                <span className="text-[10px] tabular-nums">
                  {r.lastExecuted
                    ? t('drills.lastWas', 'Último:') + ' ' + r.lastExecuted.slice(0, 10)
                    : t('drills.never', 'Nunca ejecutado')}
                </span>
                {onScheduleClick && (
                  <button
                    type="button"
                    onClick={() => onScheduleClick(r.kind)}
                    data-testid={`drill-schedule-${r.kind}`}
                    className="text-[10px] font-bold underline"
                  >
                    {t('drills.schedule', 'Agendar')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {upcoming.length > 0 && (
        <div data-testid="drills-upcoming">
          <h3 className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-300 mb-1.5">
            {t('drills.upcomingHeader', 'Próximos')}
          </h3>
          <ul className="space-y-1">
            {upcoming.map((r) => (
              <li
                key={r.kind}
                data-testid={`drill-upcoming-${r.kind}`}
                className="flex items-center gap-2 text-xs p-2 rounded bg-emerald-500/5"
              >
                <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-500" aria-hidden="true" />
                <span className="flex-1">{KIND_LABEL[r.kind]}</span>
                <span className="text-[10px] tabular-nums opacity-80">
                  {t('drills.inDays', `En ${r.daysUntilDue}d`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
