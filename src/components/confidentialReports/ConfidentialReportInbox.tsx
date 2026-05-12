// Praeventio Guard — Wire UI #20: <ConfidentialReportInbox />
//
// Bandeja del confidential_handler con reportes pendientes,
// SLAs visibles (Ley Karin), flag de represalia.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, AlertOctagon, Clock } from 'lucide-react';
import {
  computeLegalDeadlines,
  type ConfidentialReport,
  type ConfidentialReportKind,
} from '../../services/confidentialReports/confidentialReportsService.js';

interface ConfidentialReportInboxProps {
  reports: ConfidentialReport[];
  /** Flags de represalia ya detectados. */
  retaliationReportIds?: Set<string>;
  onReportClick?: (id: string) => void;
}

const KIND_LABEL: Record<ConfidentialReportKind, string> = {
  harassment_sexual: 'Acoso sexual',
  harassment_workplace: 'Acoso laboral',
  violence: 'Violencia',
  discrimination: 'Discriminación',
  unsafe_behavior: 'Conducta insegura',
  conflict_of_interest: 'Conflicto interés',
  other_sensitive: 'Otro confidencial',
};

const SLA_CLASS = {
  on_track: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  at_risk: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  breached: 'bg-rose-500/20 text-rose-700 dark:text-rose-300',
};

export function ConfidentialReportInbox({
  reports,
  retaliationReportIds,
  onReportClick,
}: ConfidentialReportInboxProps) {
  const { t } = useTranslation();

  const enriched = useMemo(() => {
    return reports
      .map((r) => ({ report: r, sla: computeLegalDeadlines(r) }))
      .sort((a, b) => {
        // breached primero, luego at_risk, luego on_track
        const order = { breached: 0, at_risk: 1, on_track: 2 };
        return order[a.sla.slaStatus] - order[b.sla.slaStatus];
      });
  }, [reports]);

  if (enriched.length === 0) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-6 text-center text-secondary-token"
        data-testid="confidential-inbox-empty"
      >
        <Shield className="w-6 h-6 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <p className="text-xs">
          {t('confidential.empty', 'Bandeja confidencial vacía. Sin reportes pendientes.')}
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="confidential-inbox"
      aria-label={t('confidential.aria', 'Bandeja confidencial') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-purple-600" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('confidential.title', 'Bandeja Confidencial — Ley Karin')}
        </h2>
        <span className="ml-auto text-xs text-secondary-token">{enriched.length}</span>
      </header>

      <ul className="space-y-2.5">
        {enriched.map(({ report, sla }) => {
          const hasRetaliation = retaliationReportIds?.has(report.id) ?? false;
          return (
            <li
              key={report.id}
              data-testid={`confidential-report-${report.id}`}
              className={`rounded-lg border p-3 ${
                hasRetaliation
                  ? 'border-rose-500/50 bg-rose-500/5'
                  : 'border-default-token bg-surface-elevated'
              }`}
            >
              <button
                type="button"
                onClick={() => onReportClick?.(report.id)}
                disabled={!onReportClick}
                className={`w-full text-left ${onReportClick ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-bold text-primary-token">
                    {KIND_LABEL[report.kind]}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${SLA_CLASS[sla.slaStatus]}`}
                    data-testid={`confidential-sla-${report.id}`}
                  >
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    {sla.slaStatus === 'breached'
                      ? t('confidential.slaBreached', 'SLA INCUMPLIDO')
                      : sla.slaStatus === 'at_risk'
                        ? t('confidential.slaAtRisk', 'Riesgo SLA')
                        : t('confidential.slaOk', 'En plazo')}
                  </span>
                </div>
                <p className="text-[10px] text-secondary-token mb-1.5">
                  {t('confidential.submittedAt', 'Recibido:')}{' '}
                  {report.submittedAt.slice(0, 16).replace('T', ' ')}
                </p>
                <p className="text-[10px] text-secondary-token uppercase">
                  Status: <strong>{report.status}</strong>
                </p>
                {hasRetaliation && (
                  <div
                    className="mt-2 flex items-center gap-1 text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-500/15 px-2 py-1 rounded"
                    data-testid={`confidential-retaliation-${report.id}`}
                  >
                    <AlertOctagon className="w-3 h-3" aria-hidden="true" />
                    {t('confidential.retaliationFlag', 'Posible represalia detectada')}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
