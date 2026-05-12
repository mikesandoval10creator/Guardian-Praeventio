// Praeventio Guard — Wire UI #44: <MonthlyClientReportCard />
//
// Card del reporte mensual al cliente con KPIs + alertas reputacionales
// + SLA compliance + executiveSummary.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, AlertOctagon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  buildMonthlyClientReport,
  type MonthlyInputs,
  type MonthlyClientReport,
} from '../../services/clientReporting/monthlyClientReport.js';

interface MonthlyClientReportCardProps {
  inputs: MonthlyInputs;
}

const SLA_CLASS: Record<MonthlyClientReport['slaCompliance'][number]['status'], string> = {
  met: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  at_risk: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  missed: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

const ALERT_CLASS: Record<MonthlyClientReport['reputationalAlerts'][number]['severity'], string> = {
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  urgent: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

export function MonthlyClientReportCard({ inputs }: MonthlyClientReportCardProps) {
  const { t } = useTranslation();
  const report = useMemo(() => buildMonthlyClientReport(inputs), [inputs]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="monthly-report-card"
      aria-label={t('monthlyReport.aria', 'Reporte mensual cliente') as string}
    >
      <header className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('monthlyReport.title', 'Reporte mensual')}
        </h2>
        <span className="ml-auto text-xs font-bold text-secondary-token">
          {report.periodLabel}
        </span>
      </header>

      <p className="text-xs text-secondary-token" data-testid="monthly-report-summary">
        {report.executiveSummary}
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2" data-testid="monthly-report-kpis">
        {report.kpis.map((k, i) => {
          const TrendIcon =
            k.trend === 'up' ? TrendingUp : k.trend === 'down' ? TrendingDown : Minus;
          return (
            <div
              key={i}
              className="rounded-lg bg-surface-elevated p-2"
              data-testid={`monthly-kpi-${i}`}
            >
              <p className="text-[10px] uppercase opacity-70 leading-tight">{k.name}</p>
              <div className="flex items-baseline gap-1">
                <p className="text-sm font-black tabular-nums">{k.value}</p>
                {k.trend && (
                  <TrendIcon
                    className={`w-3 h-3 ${
                      k.trend === 'up'
                        ? 'text-emerald-500'
                        : k.trend === 'down'
                          ? 'text-rose-500'
                          : 'text-secondary-token'
                    }`}
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reputational alerts */}
      {report.reputationalAlerts.length > 0 && (
        <div data-testid="monthly-alerts">
          <h3 className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-1 flex items-center gap-1">
            <AlertOctagon className="w-3 h-3" aria-hidden="true" />
            {t('monthlyReport.alertsTitle', 'Alertas reputacionales')}
          </h3>
          <ul className="space-y-1">
            {report.reputationalAlerts.map((a, i) => (
              <li
                key={i}
                data-testid={`monthly-alert-${i}`}
                className={`text-[11px] p-2 rounded border ${ALERT_CLASS[a.severity]}`}
              >
                {a.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SLA compliance */}
      {report.slaCompliance.length > 0 && (
        <div data-testid="monthly-sla">
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('monthlyReport.slaTitle', 'SLA compromisos')}
          </h3>
          <ul className="space-y-1">
            {report.slaCompliance.map((s, i) => (
              <li
                key={i}
                data-testid={`monthly-sla-${i}`}
                className="flex items-center justify-between p-1.5 rounded bg-surface-elevated text-xs"
              >
                <span className="flex-1">{s.name}</span>
                <span className="font-bold tabular-nums mr-2 text-[10px]">
                  {s.achieved} / {s.target}
                </span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${SLA_CLASS[s.status]}`}
                >
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
