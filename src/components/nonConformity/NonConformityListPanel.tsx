// Praeventio Guard — Wire UI: <NonConformityListPanel />
//
// Wire UI para `nonConformityEngine`. Vista del prevencionista sobre
// no-conformidades activas, su ciclo PDCA, y pattern buckets (no-
// conformidades repetidas por root-cause) detectados upstream.

import { useTranslation } from 'react-i18next';
import {
  FileWarning,
  CircleDot,
  Search,
  ClipboardList,
  CheckCircle2,
  RefreshCcw,
  TrendingUp,
} from 'lucide-react';
import type {
  NonConformity,
  NonConformitySource,
  NonConformitySeverity,
  NonConformityStatus,
  PatternBucket,
} from '../../services/nonConformity/nonConformityEngine.js';

interface NonConformityListPanelProps {
  ncs: NonConformity[];
  /** Buckets de patrón (de `bulkClassifyByPattern`). */
  patterns?: PatternBucket[];
  /** Callback al click "Investigar" / "Plan acción" / "Cerrar". */
  onAdvance?: (nc: NonConformity) => void;
  /** Callback al click en un pattern bucket. */
  onPatternClick?: (bucket: PatternBucket) => void;
}

const SOURCE_LABEL: Record<NonConformitySource, string> = {
  audit: 'Auditoría',
  inspection: 'Inspección',
  incident: 'Incidente',
  self_report: 'Auto-reporte',
  external_audit: 'Audit. externa',
  client_complaint: 'Reclamo cliente',
};

const STATUS_LABEL: Record<NonConformityStatus, string> = {
  open: 'Abierta',
  investigating: 'Investigando',
  action_planned: 'Plan asignado',
  closed: 'Cerrada',
  efficacy_reviewed: 'Eficacia revisada',
};

const STATUS_ICON: Record<NonConformityStatus, typeof CircleDot> = {
  open: CircleDot,
  investigating: Search,
  action_planned: ClipboardList,
  closed: CheckCircle2,
  efficacy_reviewed: RefreshCcw,
};

const STATUS_CLS: Record<NonConformityStatus, string> = {
  open: 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300',
  investigating:
    'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300',
  action_planned:
    'bg-teal-500/15 border-teal-500/40 text-teal-700 dark:text-teal-300',
  closed:
    'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  efficacy_reviewed:
    'bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-300',
};

const SEVERITY_LABEL: Record<NonConformitySeverity, string> = {
  minor: 'Menor',
  major: 'Mayor',
  critical: 'Crítica',
};

const SEVERITY_CLS: Record<NonConformitySeverity, string> = {
  minor: 'bg-stone-500/15 text-stone-700 dark:text-stone-300',
  major: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

/** Next button label based on PDCA stage. */
function nextActionLabel(status: NonConformityStatus): string | null {
  switch (status) {
    case 'open':
      return 'Investigar';
    case 'investigating':
      return 'Plan de acción';
    case 'action_planned':
      return 'Cerrar NC';
    case 'closed':
      return 'Revisar eficacia';
    case 'efficacy_reviewed':
      return null;
    default:
      return null;
  }
}

export function NonConformityListPanel({
  ncs,
  patterns = [],
  onAdvance,
  onPatternClick,
}: NonConformityListPanelProps) {
  const { t } = useTranslation();

  // Sort NCs: critical first, then major, then minor; within same severity
  // open status comes first.
  const severityOrder: Record<NonConformitySeverity, number> = {
    critical: 0,
    major: 1,
    minor: 2,
  };
  const statusOrder: Record<NonConformityStatus, number> = {
    open: 0,
    investigating: 1,
    action_planned: 2,
    closed: 3,
    efficacy_reviewed: 4,
  };
  const sorted = ncs.slice().sort((a, b) => {
    const ds = severityOrder[a.severity] - severityOrder[b.severity];
    if (ds !== 0) return ds;
    return statusOrder[a.status] - statusOrder[b.status];
  });

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      data-testid="non-conformity-panel"
      aria-label={t('nc.aria', 'No-conformidades activas') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <FileWarning
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
          {t('nc.title', 'No conformidades')}
        </h2>
        <span
          data-testid="nc-count"
          className="ml-auto text-[10px] uppercase tracking-wide font-bold opacity-70"
        >
          {ncs.length} {t('nc.total', 'total')}
        </span>
      </header>

      {/* Pattern alerts */}
      {patterns.length > 0 && (
        <div
          className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5"
          data-testid="nc-patterns"
        >
          <p className="text-[10px] uppercase tracking-wide font-bold text-amber-700 dark:text-amber-300 mb-1.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" aria-hidden="true" />
            {t('nc.patternsLabel', 'Patrones detectados')}
          </p>
          <ul className="space-y-1">
            {patterns.map((p) => (
              <li key={p.rootCauseKind}>
                <button
                  type="button"
                  onClick={onPatternClick ? () => onPatternClick(p) : undefined}
                  disabled={!onPatternClick}
                  data-testid={`nc-pattern-${p.rootCauseKind}`}
                  className="w-full text-left flex items-center gap-2 text-[11px] text-amber-800 dark:text-amber-200 hover:underline disabled:cursor-default disabled:no-underline"
                >
                  <span className="font-bold">{p.rootCauseKind}</span>
                  <span className="opacity-70">×{p.count}</span>
                  <span className="ml-auto font-mono text-[10px] opacity-70">
                    severidad {p.severityIndex.toFixed(1)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sorted.length === 0 ? (
        <p
          data-testid="nc-empty"
          className="text-xs italic text-stone-500 py-2 text-center"
        >
          {t('nc.empty', 'Sin no-conformidades activas')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="nc-list">
          {sorted.map((nc) => {
            const StatusIcon = STATUS_ICON[nc.status];
            const nextLabel = nextActionLabel(nc.status);
            return (
              <li
                key={nc.id}
                data-testid={`nc-item-${nc.id}`}
                data-status={nc.status}
                data-severity={nc.severity}
                className={`rounded-md border p-2.5 ${STATUS_CLS[nc.status]}`}
              >
                <div className="flex items-start gap-2">
                  <StatusIcon
                    className="w-4 h-4 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span
                        className={`inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-wide ${SEVERITY_CLS[nc.severity]}`}
                      >
                        {SEVERITY_LABEL[nc.severity]}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide font-bold opacity-75">
                        {SOURCE_LABEL[nc.source]}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide font-bold ml-auto opacity-80">
                        {STATUS_LABEL[nc.status]}
                      </span>
                    </div>
                    <p className="text-sm font-bold leading-tight mt-1">
                      {nc.description}
                    </p>
                    {nc.rootCauseKind && (
                      <p className="text-[10px] mt-0.5 opacity-70 italic">
                        Causa: {nc.rootCauseKind}
                      </p>
                    )}
                    {nc.correctiveActionIds && nc.correctiveActionIds.length > 0 && (
                      <p className="text-[10px] mt-0.5 opacity-75">
                        {nc.correctiveActionIds.length} acción(es) vinculada(s)
                      </p>
                    )}
                  </div>
                  {nextLabel && onAdvance && (
                    <button
                      type="button"
                      onClick={() => onAdvance(nc)}
                      data-testid={`nc-advance-${nc.id}`}
                      className="px-2 py-1 rounded-md bg-teal-600 text-white text-[11px] font-bold hover:brightness-110 shrink-0"
                    >
                      {nextLabel}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
