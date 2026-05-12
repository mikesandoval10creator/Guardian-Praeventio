// Praeventio Guard — Wire UI #14: <ChurnRiskPanel />
//
// Panel interno (admin / customer success) que muestra tenants en
// riesgo de churn ordenados por severidad, con signals visibles.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Users, TrendingDown } from 'lucide-react';
import {
  assessChurnRisk,
  type TenantUsageSnapshot,
  type ChurnRiskReport,
} from '../../services/adoption/adoptionAnalytics.js';

interface ChurnRiskPanelProps {
  snapshots: TenantUsageSnapshot[];
  onTenantClick?: (tenantId: string) => void;
}

const LEVEL_CLASS: Record<ChurnRiskReport['level'], string> = {
  low: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

const LEVEL_ORDER: Record<ChurnRiskReport['level'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function ChurnRiskPanel({ snapshots, onTenantClick }: ChurnRiskPanelProps) {
  const { t } = useTranslation();

  const reports = useMemo(
    () =>
      snapshots
        .map(assessChurnRisk)
        .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.riskScore - a.riskScore),
    [snapshots],
  );

  const counts = useMemo(() => {
    const r = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const rep of reports) r[rep.level] += 1;
    return r;
  }, [reports]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="churn-risk-panel"
      aria-label={t('churn.aria', 'Panel riesgo de churn') as string}
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-rose-500" aria-hidden="true" />
          {t('churn.title', 'Riesgo de Churn')}
        </h2>
        <div className="flex items-center gap-1 text-[10px] font-bold">
          {counts.critical > 0 && (
            <span className={`px-1.5 py-0.5 rounded ${LEVEL_CLASS.critical}`}>
              {counts.critical}
            </span>
          )}
          {counts.high > 0 && (
            <span className={`px-1.5 py-0.5 rounded ${LEVEL_CLASS.high}`}>{counts.high}</span>
          )}
        </div>
      </header>

      {reports.length === 0 ? (
        <p className="text-xs text-secondary-token italic">
          {t('churn.empty', 'No hay tenants para evaluar.')}
        </p>
      ) : (
        <ul className="space-y-2 max-h-96 overflow-y-auto">
          {reports.map((r) => (
            <li key={r.tenantId}>
              <button
                type="button"
                onClick={() => onTenantClick?.(r.tenantId)}
                disabled={!onTenantClick}
                data-testid={`churn-item-${r.tenantId}`}
                className={`w-full text-left rounded-lg border p-2 ${LEVEL_CLASS[r.level]} ${
                  onTenantClick ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-bold flex items-center gap-1">
                    <Users className="w-3 h-3" aria-hidden="true" />
                    {r.tenantId}
                  </span>
                  <span className="text-[10px] font-bold uppercase">{r.level}</span>
                  <span className="text-[10px] tabular-nums opacity-70">{r.riskScore}/100</span>
                </div>
                {r.signals.length > 0 && (
                  <ul className="text-[10px] opacity-85 leading-snug space-y-0.5">
                    {r.signals.slice(0, 3).map((s, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
