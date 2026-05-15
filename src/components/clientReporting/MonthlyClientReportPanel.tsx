// Praeventio Guard — Wire UI: <MonthlyClientReportPanel />
//
// Surface `buildMonthlyClientReport()` del clientReporting service para
// el mandante (cliente que contrató la faena). Muestra KPIs del período,
// alertas reputacionales si hubo SIF precursor o crítico, SLA cumplidos
// y resumen ejecutivo.
//
// Doc usuario §119-120.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileBarChart,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertOctagon,
} from 'lucide-react';
import {
  buildMonthlyClientReport,
  type MonthlyInputs,
} from '../../services/clientReporting/monthlyClientReport.js';

interface MonthlyClientReportPanelProps {
  inputs: MonthlyInputs;
}

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

const SEVERITY_STYLES = {
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  urgent: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
} as const;

const SLA_STYLES = {
  met: 'text-emerald-600',
  at_risk: 'text-amber-600',
  missed: 'text-rose-600',
} as const;

export function MonthlyClientReportPanel({ inputs }: MonthlyClientReportPanelProps) {
  const { t } = useTranslation();
  const report = useMemo(() => buildMonthlyClientReport(inputs), [inputs]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="monthly-client-report"
      aria-label={t('monthlyReport.aria', 'Reporte mensual cliente') as string}
    >
      <header className="flex items-center gap-2">
        <FileBarChart className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token">
          {t('monthlyReport.title', 'Reporte ejecutivo mensual')}
        </h2>
        <span
          className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums"
          data-testid="monthly-report-period"
        >
          {report.periodLabel}
        </span>
      </header>

      <p
        className="text-[12px] leading-snug text-secondary-token italic"
        data-testid="monthly-report-summary"
      >
        {report.executiveSummary}
      </p>

      {report.reputationalAlerts.length > 0 && (
        <div className="space-y-1" data-testid="monthly-report-alerts">
          {report.reputationalAlerts.map((alert, idx) => (
            <div
              key={idx}
              data-testid={`monthly-report-alert-${idx}`}
              className={`flex items-start gap-2 p-2 rounded text-[11px] ${SEVERITY_STYLES[alert.severity]}`}
            >
              <AlertOctagon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2" data-testid="monthly-report-kpis">
        {report.kpis.map((kpi, idx) => {
          const Icon = kpi.trend ? TREND_ICON[kpi.trend] : null;
          return (
            <div
              key={idx}
              data-testid={`monthly-report-kpi-${idx}`}
              className="bg-surface-elevated rounded p-2 space-y-1"
            >
              <p className="text-[10px] uppercase text-secondary-token truncate">
                {kpi.name}
              </p>
              <p className="text-sm font-black tabular-nums flex items-center gap-1">
                {kpi.value}
                {Icon && (
                  <Icon
                    className={`w-3 h-3 ${
                      kpi.trend === 'up'
                        ? 'text-emerald-500'
                        : kpi.trend === 'down'
                          ? 'text-rose-500'
                          : 'text-secondary-token'
                    }`}
                    aria-hidden="true"
                  />
                )}
              </p>
            </div>
          );
        })}
      </div>

      {report.slaCompliance.length > 0 && (
        <div className="space-y-1" data-testid="monthly-report-sla">
          <h3 className="text-[10px] uppercase font-bold text-secondary-token">
            {t('monthlyReport.slaTitle', 'SLA con cliente')}
          </h3>
          <ul className="space-y-1">
            {report.slaCompliance.map((sla, idx) => (
              <li
                key={idx}
                data-testid={`monthly-report-sla-${idx}`}
                className="flex items-center justify-between bg-surface-elevated rounded p-2 text-[11px]"
              >
                <span className="truncate">{sla.name}</span>
                <span className={`font-bold tabular-nums ${SLA_STYLES[sla.status]}`}>
                  {sla.achieved}/{sla.target}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
