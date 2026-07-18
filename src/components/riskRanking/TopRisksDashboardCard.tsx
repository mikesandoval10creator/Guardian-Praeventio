// Praeventio Guard — Plan 3.12 wire orphan: dashboard container for
// <TopRisksWidget />. Pulls from the HTTP surface via useTopRisks() and
// adapts the response (ranked records already include `score`) back into
// the pure RiskRecord[] that the existing presentational widget accepts.
//
// The existing `TopRisksWidget` (pure, records-in / list-out) remains the
// rendering primitive. This container is what Dashboard.tsx will mount —
// it owns fetching, loading/error states, and drill-down navigation.
//
// Click drill-down → /knowledge-base?riskId=<id> (mirrors existing
// risk-network drill-down convention used by RiskNetworkExplorer.tsx).

import { Loader2, AlertOctagon, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../contexts/ProjectContext';
import { useTopRisks } from '../../hooks/useRiskRanking';
import { TopRisksWidget } from './TopRisksWidget';
import { humanErrorMessage } from '../../lib/humanError';


export interface TopRisksDashboardCardProps {
  /** Top-N count. Default 10. */
  topN?: number;
  /** Override projectId. If absent, reads from ProjectContext. */
  projectId?: string;
  /** Custom click handler. Default navigates to /knowledge-base?riskId=...  */
  onRiskClick?: (riskId: string) => void;
}

export function TopRisksDashboardCard({
  topN = 10,
  projectId: projectIdProp,
  onRiskClick,
}: TopRisksDashboardCardProps) {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const navigate = useNavigate();
  const projectId = projectIdProp ?? selectedProject?.id ?? null;

  const { data, loading, error, refetch } = useTopRisks(projectId, topN);

  const handleClick = (riskId: string) => {
    if (onRiskClick) return onRiskClick(riskId);
    navigate(`/knowledge-base?riskId=${encodeURIComponent(riskId)}`);
  };

  if (!projectId) {
    return (
      <section className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode">
        <p className="text-xs text-secondary-token italic">
          {t('top_risks.no_project', 'Selecciona un proyecto para ver el ranking de riesgos.')}
        </p>
      </section>
    );
  }

  if (loading && !data) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode flex items-center gap-2"
        aria-busy="true"
      >
        <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
        <span className="text-xs text-muted-token">
          {t('top_risks.loading', 'Calculando ranking de riesgos…')}
        </span>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
        <div className="flex items-start gap-2">
          <AlertOctagon className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-rose-700 dark:text-rose-300">
              {t('top_risks.error', 'No se pudo cargar el ranking de riesgos.')}
            </p>
            <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80 mt-0.5 truncate">
              {humanErrorMessage(error.message)}
            </p>
            <button
              type="button"
              onClick={refetch}
              className="mt-2 text-[10px] uppercase tracking-widest font-bold text-rose-700 dark:text-rose-300 hover:underline"
            >
              {t('top_risks.retry', 'Reintentar')}
            </button>
          </div>
        </div>
      </section>
    );
  }

  // The HTTP response already comes ranked + IPER-classified server-side
  // (riskNodeRanking). TopRisksWidget renders the RankedRiskNode[] directly.
  const ranked = data?.topRisks ?? [];

  return (
    <div className="space-y-1">
      <TopRisksWidget risks={ranked} topN={topN} onRiskClick={handleClick} />
      <div className="flex items-center justify-end px-2">
        <Link
          to="/risks"
          className="flex items-center gap-0.5 text-[10px] uppercase tracking-widest font-bold accent-text hover:underline"
        >
          {t('top_risks.see_all', 'Ver todos los riesgos')}
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
