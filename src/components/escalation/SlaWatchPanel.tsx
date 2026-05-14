// Praeventio Guard — Wire UI: <SlaWatchPanel />
//
// Wire UI para `escalationSlaEngine`. Visualiza items de workflow
// agrupados por SLA state (within / near breach / breached / overdue)
// con assessments computados upstream. Permite al prevencionista o
// supervisor escalar manualmente uno-a-uno.

import { useTranslation } from 'react-i18next';
import {
  Timer,
  AlertTriangle,
  AlertOctagon,
  Clock,
  ArrowUpRight,
  ShieldAlert,
  FileWarning,
} from 'lucide-react';
import type {
  WorkflowItem,
  WorkflowItemKind,
  SeverityLevel,
  SlaState,
  SlaAssessment,
} from '../../services/escalation/escalationSlaEngine.js';

export interface AssessedItem {
  item: WorkflowItem;
  assessment: SlaAssessment;
  /** Etiqueta legible para el item (caller-provided). */
  label?: string;
}

interface SlaWatchPanelProps {
  items: AssessedItem[];
  /** Callback al click "Escalar" — caller dispara escalateOneOrMany. */
  onEscalate?: (item: AssessedItem) => void;
  /** Si está true, oculta los items en `within_sla` para enfocar el riesgo. */
  hideHealthy?: boolean;
}

const STATE_META: Record<
  SlaState,
  { Icon: typeof Timer; label: string; cls: string; order: number }
> = {
  permanently_overdue: {
    Icon: AlertOctagon,
    label: 'Permanentemente vencido',
    cls: 'bg-rose-700/15 border-rose-700/50 text-rose-900 dark:text-rose-200',
    order: 0,
  },
  breached: {
    Icon: AlertOctagon,
    label: 'SLA vencido',
    cls: 'bg-rose-500/15 border-rose-500/50 text-rose-700 dark:text-rose-300',
    order: 1,
  },
  near_breach: {
    Icon: AlertTriangle,
    label: 'Cerca del límite',
    cls: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300',
    order: 2,
  },
  within_sla: {
    Icon: Clock,
    label: 'Dentro del SLA',
    cls: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    order: 3,
  },
};

const KIND_LABEL: Record<WorkflowItemKind, string> = {
  incident: 'Incidente',
  corrective_action: 'Acción correctiva',
  non_conformity: 'No conformidad',
  work_permit: 'Permiso',
  sos_alert: 'SOS',
  exception_request: 'Excepción',
  audit_finding: 'Hallazgo auditoría',
};

const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Crítico',
  sif: 'SIF',
};

const SEVERITY_CLS: Record<SeverityLevel, string> = {
  low: 'bg-stone-500/15 text-stone-700 dark:text-stone-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  high: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  sif: 'bg-rose-700/30 text-rose-900 dark:text-rose-200',
};

function formatMinutes(min: number): string {
  if (Math.abs(min) < 60) return `${min} min`;
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  const sign = min < 0 ? '-' : '';
  return `${sign}${h}h${m ? ` ${m}m` : ''}`;
}

export function SlaWatchPanel({
  items,
  onEscalate,
  hideHealthy = false,
}: SlaWatchPanelProps) {
  const { t } = useTranslation();

  const filtered = hideHealthy
    ? items.filter((i) => i.assessment.state !== 'within_sla')
    : items;

  // Sort: most-urgent first (permanently_overdue > breached > near_breach > within_sla)
  const sorted = filtered.slice().sort((a, b) => {
    const sa = STATE_META[a.assessment.state].order;
    const sb = STATE_META[b.assessment.state].order;
    if (sa !== sb) return sa - sb;
    // Within same state, more consumed fraction first.
    return b.assessment.consumedFraction - a.assessment.consumedFraction;
  });

  // Aggregate counts for header.
  const counts = items.reduce(
    (acc, x) => {
      acc[x.assessment.state] = (acc[x.assessment.state] ?? 0) + 1;
      return acc;
    },
    {} as Record<SlaState, number>,
  );

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      data-testid="sla-watch-panel"
      aria-label={t('sla.aria', 'Vigilancia de SLA en items de workflow') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Timer
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
          {t('sla.title', 'SLA Watch')}
        </h2>
        <div
          data-testid="sla-watch-summary"
          className="ml-auto flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide"
        >
          {counts.permanently_overdue ? (
            <span className="px-1.5 py-0.5 rounded bg-rose-700 text-white">
              {counts.permanently_overdue} OVD
            </span>
          ) : null}
          {counts.breached ? (
            <span className="px-1.5 py-0.5 rounded bg-rose-500 text-white">
              {counts.breached} BRC
            </span>
          ) : null}
          {counts.near_breach ? (
            <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white">
              {counts.near_breach} NEAR
            </span>
          ) : null}
          {counts.within_sla ? (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500 text-white">
              {counts.within_sla} OK
            </span>
          ) : null}
        </div>
      </header>

      {sorted.length === 0 ? (
        <p
          data-testid="sla-watch-empty"
          className="text-xs italic text-stone-500 py-2 text-center"
        >
          {hideHealthy && items.length > 0
            ? t('sla.allHealthy', 'Todos los items dentro del SLA')
            : t('sla.noItems', 'Sin items en seguimiento')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="sla-watch-items">
          {sorted.map(({ item, assessment, label }) => {
            const meta = STATE_META[assessment.state];
            const pct = Math.min(100, Math.round(assessment.consumedFraction * 100));
            return (
              <li
                key={item.id}
                data-testid={`sla-watch-item-${item.id}`}
                data-state={assessment.state}
                className={`rounded-md border p-2.5 ${meta.cls}`}
              >
                <div className="flex items-start gap-2">
                  <meta.Icon
                    className="w-4 h-4 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wide font-bold opacity-75">
                        {KIND_LABEL[item.kind]}
                      </span>
                      <span
                        className={`inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-wide ${SEVERITY_CLS[item.severity]}`}
                      >
                        {SEVERITY_LABEL[item.severity]}
                      </span>
                      {item.currentLevel && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] opacity-70">
                          <ShieldAlert className="w-2.5 h-2.5" aria-hidden="true" />
                          Lvl {item.currentLevel}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold leading-tight mt-0.5 truncate">
                      {label ?? item.id}
                    </p>
                    <div className="flex items-center gap-3 text-[11px] mt-1 opacity-85">
                      <span className="inline-flex items-center gap-0.5">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {formatMinutes(assessment.ageMinutes)} /{' '}
                        {formatMinutes(assessment.slaMinutes)}
                      </span>
                      <span className="font-mono">
                        {pct}% consumido
                      </span>
                    </div>
                    {/* SLA bar */}
                    <div className="w-full h-1 rounded-full bg-black/10 dark:bg-white/10 mt-1.5 overflow-hidden">
                      <div
                        data-testid={`sla-watch-item-${item.id}-bar`}
                        style={{ width: `${pct}%` }}
                        className={`h-full transition-all ${
                          assessment.state === 'within_sla'
                            ? 'bg-emerald-500'
                            : assessment.state === 'near_breach'
                              ? 'bg-amber-500'
                              : assessment.state === 'breached'
                                ? 'bg-rose-500'
                                : 'bg-rose-700'
                        }`}
                      />
                    </div>
                  </div>
                  {onEscalate && assessment.state !== 'within_sla' && (
                    <button
                      type="button"
                      onClick={() => onEscalate({ item, assessment, label })}
                      data-testid={`sla-watch-escalate-${item.id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-600 text-white text-[11px] font-bold hover:brightness-110 shrink-0"
                    >
                      <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                      {t('sla.escalate', 'Escalar')}
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
