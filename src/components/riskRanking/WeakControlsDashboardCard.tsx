// Praeventio Guard — Plan 3.12 wire orphan: dashboard container for
// <WeakControlsWidget />. Pulls from the HTTP surface via useWeakControls()
// and feeds the existing pure widget.
//
// Click drill-down → /risks?controlId=<id> (controls live under the Risks
// surface; the Risks page already accepts ?controlId for deep-link).

import { Loader2, AlertOctagon, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../contexts/ProjectContext';
import { useWeakControls } from '../../hooks/useRiskRanking';
import { WeakControlsWidget } from './WeakControlsWidget';
import { humanErrorMessage } from '../../lib/humanError';


export interface WeakControlsDashboardCardProps {
  /** Top-N count. Default 10. */
  topN?: number;
  /** Override projectId. If absent, reads from ProjectContext. */
  projectId?: string;
  /** Custom click handler. Default navigates to /risks?controlId=...  */
  onControlClick?: (controlId: string) => void;
}

export function WeakControlsDashboardCard({
  topN = 10,
  projectId: projectIdProp,
  onControlClick,
}: WeakControlsDashboardCardProps) {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const navigate = useNavigate();
  const projectId = projectIdProp ?? selectedProject?.id ?? null;

  const { data, loading, error, refetch } = useWeakControls(projectId, topN);

  const handleClick = (controlId: string) => {
    if (onControlClick) return onControlClick(controlId);
    navigate(`/risks?controlId=${encodeURIComponent(controlId)}`);
  };

  if (!projectId) {
    return (
      <section className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode">
        <p className="text-xs text-secondary-token italic">
          {t('weak_controls.no_project', 'Selecciona un proyecto para ver controles débiles.')}
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
          {t('weak_controls.loading', 'Calculando ranking de controles…')}
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
              {t('weak_controls.error', 'No se pudieron cargar los controles débiles.')}
            </p>
            <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80 mt-0.5 truncate">
              {humanErrorMessage(error.message)}
            </p>
            <button
              type="button"
              onClick={refetch}
              className="mt-2 text-[10px] uppercase tracking-widest font-bold text-rose-700 dark:text-rose-300 hover:underline"
            >
              {t('weak_controls.retry', 'Reintentar')}
            </button>
          </div>
        </div>
      </section>
    );
  }

  // HTTP returns ControlWeakness[] already ranked server-side
  // (controlValidationAggregation). WeakControlsWidget renders it directly.
  const ranked = data?.weakControls ?? [];

  return (
    <div className="space-y-1">
      <WeakControlsWidget controls={ranked} topN={topN} onControlClick={handleClick} />
      <div className="flex items-center justify-end px-2">
        <Link
          to="/risks"
          className="flex items-center gap-0.5 text-[10px] uppercase tracking-widest font-bold accent-text hover:underline"
        >
          {t('weak_controls.see_all', 'Ver todos los controles')}
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
