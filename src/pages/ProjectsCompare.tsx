// Praeventio Guard — Sprint 55 Fase F.27 page wrapper.
//
// Comparador de Proyectos: side-by-side KPIs de hasta 4 proyectos.
// Selecciona desde el ProjectContext (multi-select hasta MAX=4); el
// servicio `projectComparator.compareProjects` produce el reporte con
// rankings normalizados.
//
// Directiva 2: NO recomienda decisión, sólo asiste. Las observaciones
// describen diferencias sin sugerir cierre de proyecto.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  WifiOff,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  compareProjects,
  MAX_PROJECTS_TO_COMPARE,
  MIN_PROJECTS_TO_COMPARE,
  METRIC_DIRECTIONS,
  METRIC_LABELS_ES,
  ProjectComparatorError,
  type ComparisonMetricKey,
  type ProjectSnapshot,
} from '../services/projectComparator/projectComparator';

interface ProjectsCompareProps {
  /** Mapa projectId → snapshot. Caller server-side los pre-agrega desde
   *  el grafo Zettelkasten (incidents/findings/audits/risks). Vacío =
   *  empty state. */
  snapshots?: Record<string, ProjectSnapshot>;
}

export function ProjectsCompare({ snapshots = {} }: ProjectsCompareProps) {
  const { t } = useTranslation();
  const { projects } = useProject();
  const isOnline = useOnlineStatus();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const eligibleProjects = useMemo(
    () => projects.filter((p) => snapshots[p.id]),
    [projects, snapshots],
  );

  const selectedSnapshots: ProjectSnapshot[] = useMemo(() => {
    return selectedIds
      .map((id) => snapshots[id])
      .filter((s): s is ProjectSnapshot => Boolean(s));
  }, [selectedIds, snapshots]);

  const report = useMemo(() => {
    if (selectedSnapshots.length < MIN_PROJECTS_TO_COMPARE) return null;
    try {
      return compareProjects(selectedSnapshots);
    } catch (err) {
      if (err instanceof ProjectComparatorError) return null;
      throw err;
    }
  }, [selectedSnapshots]);

  function toggleProject(projectId: string) {
    setSelectedIds((curr) => {
      if (curr.includes(projectId)) {
        return curr.filter((id) => id !== projectId);
      }
      if (curr.length >= MAX_PROJECTS_TO_COMPARE) {
        return curr;
      }
      return [...curr, projectId];
    });
  }

  if (eligibleProjects.length === 0) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="projects-compare-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Briefcase
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('projectsCompare.page.title', 'Comparador de Proyectos')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'projectsCompare.page.noEligible',
              'Sin proyectos con KPIs disponibles para comparar.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-6xl mx-auto space-y-4"
      data-testid="projects-compare-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20">
          <Briefcase className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('projectsCompare.page.title', 'Comparador de Proyectos')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'projectsCompare.page.subtitle',
              'Side-by-side KPIs · selecciona entre {{min}} y {{max}} proyectos.',
              { min: MIN_PROJECTS_TO_COMPARE, max: MAX_PROJECTS_TO_COMPARE },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="projects-compare-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {/* Selector */}
      <section
        className="rounded-2xl border border-default-token bg-surface p-4"
        data-testid="projects-compare-selector"
      >
        <h2 className="text-xs font-black text-primary-token uppercase tracking-wider mb-3">
          {t('projectsCompare.selector.title', 'Elegir proyectos')} ({selectedIds.length}/{MAX_PROJECTS_TO_COMPARE})
        </h2>
        <div className="flex flex-wrap gap-2">
          {eligibleProjects.map((p) => {
            const isSelected = selectedIds.includes(p.id);
            const atLimit = !isSelected && selectedIds.length >= MAX_PROJECTS_TO_COMPARE;
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => toggleProject(p.id)}
                disabled={atLimit}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border transition ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                    : atLimit
                    ? 'border-default-token text-secondary-token opacity-50 cursor-not-allowed'
                    : 'border-default-token text-primary-token hover:border-blue-400'
                }`}
                data-testid={`projects-compare-toggle-${p.id}`}
                aria-pressed={isSelected}
              >
                {isSelected && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                {p.name}
              </button>
            );
          })}
        </div>
      </section>

      {selectedIds.length < MIN_PROJECTS_TO_COMPARE && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center"
          data-testid="projects-compare-need-more"
        >
          <p className="text-sm text-secondary-token">
            {t(
              'projectsCompare.hint.needMore',
              'Selecciona al menos {{min}} proyectos para comparar.',
              { min: MIN_PROJECTS_TO_COMPARE },
            )}
          </p>
        </div>
      )}

      {report && (
        <>
          {/* Overall ranking */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4"
            data-testid="projects-compare-ranking"
          >
            <h2 className="text-sm font-black text-primary-token uppercase tracking-wider mb-3">
              {t('projectsCompare.ranking.title', 'Ranking global')}
            </h2>
            <ol className="space-y-2">
              {report.overallRanking.map((r, idx) => (
                <li
                  key={r.projectId}
                  className="flex items-center gap-3 p-2 rounded-lg border border-default-token bg-surface"
                  data-testid={`projects-compare-rank-${idx}`}
                >
                  <span className="text-lg font-black text-primary-token w-6">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-sm font-bold text-primary-token">
                    {r.projectName}
                  </span>
                  <span className="text-xs text-secondary-token">
                    {t('projectsCompare.ranking.kpiWins', '{{n}} KPI(s) líder', {
                      n: r.kpiWins,
                    })}
                  </span>
                  <span className="text-sm font-mono font-black text-blue-600 dark:text-blue-400">
                    {r.overallScore}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* KPI table */}
          <section
            className="rounded-2xl border border-default-token bg-surface overflow-auto"
            data-testid="projects-compare-table"
          >
            <table className="w-full text-sm">
              <thead className="bg-zinc-500/5">
                <tr>
                  <th className="text-left p-3 text-xs font-black text-primary-token uppercase tracking-wider">
                    {t('projectsCompare.table.kpi', 'KPI')}
                  </th>
                  {report.projects.map((p) => (
                    <th
                      key={p.projectId}
                      className="text-center p-3 text-xs font-black text-primary-token uppercase tracking-wider"
                    >
                      {p.projectName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.metricComparisons.map((mc) => (
                  <tr
                    key={mc.metric}
                    className="border-t border-default-token"
                    data-testid={`projects-compare-row-${mc.metric}`}
                  >
                    <td className="p-3">
                      <p className="font-bold text-primary-token">
                        {t(
                          `projectsCompare.metric.${mc.metric}`,
                          METRIC_LABELS_ES[mc.metric as ComparisonMetricKey],
                        )}
                      </p>
                      <p className="text-[10px] text-secondary-token uppercase tracking-wider">
                        {mc.direction === 'higher_is_better' ? (
                          <>
                            <TrendingUp className="inline w-3 h-3" aria-hidden="true" />{' '}
                            {t('projectsCompare.dir.higher', 'mayor = mejor')}
                          </>
                        ) : (
                          <>
                            <TrendingDown className="inline w-3 h-3" aria-hidden="true" />{' '}
                            {t('projectsCompare.dir.lower', 'menor = mejor')}
                          </>
                        )}
                      </p>
                    </td>
                    {report.projects.map((p, projectIdx) => {
                      const value = mc.values[projectIdx];
                      const normalized = mc.normalizedScores[projectIdx];
                      const isWinner = mc.winnerProjectId === p.projectId;
                      return (
                        <td
                          key={p.projectId}
                          className={`text-center p-3 ${
                            isWinner
                              ? 'bg-teal-500/10 font-black text-teal-700 dark:text-teal-300'
                              : 'text-primary-token'
                          }`}
                          data-testid={`projects-compare-cell-${mc.metric}-${p.projectId}`}
                        >
                          <p className="font-mono">{value}</p>
                          <p className="text-[10px] text-secondary-token">
                            {Math.round(normalized)}/100
                          </p>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Observations */}
          {report.observations.length > 0 && (
            <section
              className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4"
              data-testid="projects-compare-observations"
            >
              <h2 className="text-sm font-black text-primary-token uppercase tracking-wider mb-2 flex items-center gap-2">
                <Minus className="w-4 h-4 text-blue-500" aria-hidden="true" />
                {t('projectsCompare.observations.title', 'Observaciones')}
              </h2>
              <ul className="space-y-1.5 text-sm text-primary-token">
                {report.observations.map((o, idx) => (
                  <li key={idx}>· {o}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default ProjectsCompare;
