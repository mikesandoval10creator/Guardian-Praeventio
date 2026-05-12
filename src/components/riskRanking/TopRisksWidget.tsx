// Praeventio Guard — Wire UI #4a: <TopRisksWidget />
//
// Sidebar widget showing the Top N risks of the current project, ranked
// by the deterministic score (severity × incidents × overdue × exposure).
// Consumes `rankRisks` from `riskRanking/riskRankingEngine.ts`.
//
// Used in: ProjectDetail right sidebar, Dashboard secondary column.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, ArrowUpRight } from 'lucide-react';
import {
  rankRisks,
  type RiskRecord,
  type RiskSeverity,
} from '../../services/riskRanking/riskRankingEngine.js';

interface TopRisksWidgetProps {
  risks: RiskRecord[];
  topN?: number;
  onRiskClick?: (riskId: string) => void;
}

const SEVERITY_DOT: Record<RiskSeverity, string> = {
  low: 'bg-sky-500',
  medium: 'bg-amber-500',
  high: 'bg-orange-500',
  critical: 'bg-rose-500',
};

export function TopRisksWidget({ risks, topN = 5, onRiskClick }: TopRisksWidgetProps) {
  const { t } = useTranslation();
  const ranked = useMemo(() => rankRisks(risks, topN), [risks, topN]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="top-risks-widget"
      aria-label={t('top_risks.aria', 'Top riesgos del proyecto') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Flame className="w-4 h-4 text-rose-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('top_risks.title', `Top ${topN} riesgos`, { count: topN })}
        </h2>
      </header>

      {ranked.length === 0 ? (
        <p className="text-xs text-secondary-token italic">
          {t('top_risks.empty', 'Sin riesgos rankeables todavía.')}
        </p>
      ) : (
        <ol className="space-y-2">
          {ranked.map((r, idx) => (
            <li
              key={r.id}
              className="flex items-center gap-2"
              data-testid={`top-risk-${r.id}`}
            >
              <span className="text-xs font-bold w-4 text-muted-token tabular-nums">
                {idx + 1}.
              </span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[r.severity]}`}
                aria-label={r.severity}
              />
              <button
                type="button"
                onClick={() => onRiskClick?.(r.id)}
                disabled={!onRiskClick}
                className="flex-1 min-w-0 text-left text-xs text-primary-token hover:underline disabled:no-underline disabled:cursor-default"
              >
                <span className="font-semibold">{r.category}</span>
                <span className="text-muted-token ml-1">
                  ({r.exposedWorkerCount} {t('top_risks.workers', 'trab.')})
                </span>
              </button>
              <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                {r.score}
              </span>
              {onRiskClick && <ArrowUpRight className="w-3 h-3 text-muted-token" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
