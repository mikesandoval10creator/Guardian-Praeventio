// Praeventio Guard — Wire UI #48: <ActionBalanceCard />
//
// Muestra el balance del portfolio de acciones correctivas por nivel
// (ISO 45001) y flag si está desbalanceado (>70% capacitaciones).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Scale, AlertTriangle } from 'lucide-react';
import {
  buildBalanceReport,
  type CorrectiveAction,
  type CorrectiveActionLevel,
} from '../../services/correctiveActions/weakActionDetector.js';

interface ActionBalanceCardProps {
  actions: CorrectiveAction[];
}

const LEVEL_ORDER: CorrectiveActionLevel[] = [
  'elimination',
  'engineering',
  'administrative',
  'training',
  'epp',
  'supervision',
  'communication',
];

const LEVEL_TONE: Record<CorrectiveActionLevel, string> = {
  elimination: 'bg-emerald-500',
  engineering: 'bg-teal-500',
  administrative: 'bg-sky-500',
  training: 'bg-amber-500',
  epp: 'bg-orange-500',
  supervision: 'bg-violet-500',
  communication: 'bg-slate-500',
};

export function ActionBalanceCard({ actions }: ActionBalanceCardProps) {
  const { t } = useTranslation();
  const report = useMemo(() => buildBalanceReport(actions), [actions]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="action-balance-card"
      aria-label={t('actionBalance.aria', 'Balance de acciones correctivas') as string}
    >
      <header className="flex items-center gap-2">
        <Scale className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('actionBalance.title', 'Balance acciones')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token tabular-nums">
          {report.total} {t('actionBalance.totalLabel', 'acciones')}
        </span>
      </header>

      {report.isImbalanced && (
        <div
          className="flex items-start gap-2 text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded"
          data-testid="action-balance-imbalanced"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{report.message}</span>
        </div>
      )}

      <div data-testid="action-balance-bars" className="space-y-1.5">
        {LEVEL_ORDER.map((level) => {
          const count = report.byLevel[level];
          const pct = report.total > 0 ? Math.round((count / report.total) * 100) : 0;
          return (
            <div key={level} data-testid={`action-balance-row-${level}`}>
              <div className="flex justify-between text-[10px] mb-0.5">
                <span className="uppercase font-bold">{level}</span>
                <span className="tabular-nums text-secondary-token">
                  {count} ({pct}%)
                </span>
              </div>
              <div className="h-1.5 bg-surface-elevated rounded overflow-hidden">
                <div
                  className={`h-full ${LEVEL_TONE[level]}`}
                  style={{ width: `${pct}%` }}
                  data-testid={`action-balance-bar-${level}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] text-secondary-token">
        <span>
          {t('actionBalance.highTier', 'Alta jerarquía')}:{' '}
          <span className="tabular-nums font-bold">
            {Math.round(report.highTierShare * 100)}%
          </span>
        </span>
        <span>
          {t('actionBalance.training', 'Capacitaciones')}:{' '}
          <span className="tabular-nums font-bold">
            {Math.round(report.trainingShare * 100)}%
          </span>
        </span>
      </div>
    </section>
  );
}
