// Praeventio Guard — Wire UI #6: <ConsistencyAuditCard />
//
// Inbox card that summarizes detected inconsistencies between modules.
// Consumes `Inconsistency[]` from `consistency/consistencyAuditor.ts`.
//
// Used in: Inbox / Dashboard prevencionista section.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, Info, ChevronRight } from 'lucide-react';
import type {
  Inconsistency,
  InconsistencySeverity,
} from '../../services/consistency/consistencyAuditor.js';

interface ConsistencyAuditCardProps {
  inconsistencies: Inconsistency[];
  onResolve?: (inconsistency: Inconsistency) => void;
  /** Max items to display inline. Rest collapses behind a counter. */
  maxInline?: number;
}

const SEVERITY_ICON: Record<InconsistencySeverity, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
};

const SEVERITY_CLASS: Record<InconsistencySeverity, string> = {
  info: 'text-sky-700 dark:text-sky-300 bg-sky-500/10',
  warning: 'text-amber-700 dark:text-amber-300 bg-amber-500/10',
  critical: 'text-rose-700 dark:text-rose-300 bg-rose-500/10',
};

const SEVERITY_ORDER: Record<InconsistencySeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function ConsistencyAuditCard({
  inconsistencies,
  onResolve,
  maxInline = 5,
}: ConsistencyAuditCardProps) {
  const { t } = useTranslation();

  const sorted = useMemo(
    () =>
      [...inconsistencies].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      ),
    [inconsistencies],
  );

  const counts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let info = 0;
    for (const i of inconsistencies) {
      if (i.severity === 'critical') critical += 1;
      else if (i.severity === 'warning') warning += 1;
      else info += 1;
    }
    return { critical, warning, info };
  }, [inconsistencies]);

  if (inconsistencies.length === 0) {
    return (
      <article
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center"
        data-testid="consistency-audit-card-empty"
      >
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          {t('consistency_audit.clean', 'Sin inconsistencias detectadas')}
        </p>
        <p className="text-xs text-emerald-600 dark:text-emerald-400/80 mt-1">
          {t('consistency_audit.clean_subtitle', 'Tu información está alineada entre módulos.')}
        </p>
      </article>
    );
  }

  const inline = sorted.slice(0, maxInline);
  const hiddenCount = sorted.length - inline.length;

  return (
    <article
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="consistency-audit-card"
      aria-label={t('consistency_audit.aria', 'Auditoría de consistencia') as string}
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('consistency_audit.title', 'Inconsistencias detectadas')}
        </h2>
        <div className="flex items-center gap-1 text-[10px] font-bold">
          {counts.critical > 0 && (
            <span className={`px-1.5 py-0.5 rounded ${SEVERITY_CLASS.critical}`}>
              {counts.critical}
            </span>
          )}
          {counts.warning > 0 && (
            <span className={`px-1.5 py-0.5 rounded ${SEVERITY_CLASS.warning}`}>
              {counts.warning}
            </span>
          )}
          {counts.info > 0 && (
            <span className={`px-1.5 py-0.5 rounded ${SEVERITY_CLASS.info}`}>
              {counts.info}
            </span>
          )}
        </div>
      </header>

      <ul className="space-y-2">
        {inline.map((i) => {
          const Icon = SEVERITY_ICON[i.severity];
          const clickable = Boolean(onResolve);
          return (
            <li key={i.ruleId + i.involvedIds.join('-')}>
              <button
                type="button"
                onClick={clickable ? () => onResolve?.(i) : undefined}
                disabled={!clickable}
                data-testid={`consistency-item-${i.ruleId}`}
                className={`w-full text-left flex items-start gap-2 p-2 rounded-lg ${SEVERITY_CLASS[i.severity]} ${clickable ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'}`}
              >
                <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold leading-tight">{i.description}</p>
                  <p className="text-[10px] opacity-80 mt-0.5">{i.suggestedAction}</p>
                </div>
                {clickable && <ChevronRight className="w-3 h-3 shrink-0 mt-1" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && (
        <p className="text-[10px] text-secondary-token mt-2 text-center" data-testid="consistency-hidden-count">
          {t('consistency_audit.more', `+${hiddenCount} más en bandeja completa`, { count: hiddenCount })}
        </p>
      )}
    </article>
  );
}
