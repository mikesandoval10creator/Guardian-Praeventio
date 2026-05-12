// Praeventio Guard — Wire UI #45: <ProjectClosureCard />
//
// Valida si un proyecto puede cerrarse + muestra summary multi-audience.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlagOff, AlertCircle, CheckCircle2, Eye } from 'lucide-react';
import {
  validateClosureReadiness,
  buildSummary,
  type ClosureContext,
  type ProjectClosureSnapshot,
  type SummaryAudience,
} from '../../services/projectClosure/projectClosureService.js';

interface ProjectClosureCardProps {
  context: ClosureContext;
  snapshot: ProjectClosureSnapshot;
  onConfirmClose?: () => void;
}

const AUDIENCE_OPTIONS: Array<{ value: SummaryAudience; label: string }> = [
  { value: 'management', label: 'Gerencia' },
  { value: 'client', label: 'Cliente' },
  { value: 'operations', label: 'Operaciones' },
  { value: 'regulatory', label: 'Regulatorio' },
];

export function ProjectClosureCard({
  context,
  snapshot,
  onConfirmClose,
}: ProjectClosureCardProps) {
  const { t } = useTranslation();
  const readiness = useMemo(() => validateClosureReadiness(context), [context]);
  const [audience, setAudience] = useState<SummaryAudience>('management');
  const summary = useMemo(
    () => buildSummary(audience, snapshot),
    [audience, snapshot],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-4"
      data-testid="closure-card"
      aria-label={t('closure.aria', 'Cierre de proyecto') as string}
    >
      <header className="flex items-center gap-2">
        <FlagOff className="w-4 h-4 text-amber-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('closure.title', 'Cierre de Proyecto')}
        </h2>
        {readiness.canClose ? (
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            data-testid="closure-ready"
          >
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            {t('closure.ready', 'Listo para cerrar')}
          </span>
        ) : (
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300"
            data-testid="closure-blocked"
          >
            <AlertCircle className="w-3 h-3" aria-hidden="true" />
            {t('closure.blocked', 'Cierre bloqueado')}
          </span>
        )}
      </header>

      {/* Blockers */}
      {readiness.blockers.length > 0 && (
        <div data-testid="closure-blockers">
          <h3 className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-1">
            {t('closure.blockersTitle', 'Bloqueadores')}
          </h3>
          <ul className="space-y-1">
            {readiness.blockers.map((b, i) => (
              <li
                key={i}
                className="text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-1 bg-rose-500/5 p-1.5 rounded"
              >
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {readiness.warnings.length > 0 && (
        <div data-testid="closure-warnings">
          <h3 className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-300 mb-1">
            {t('closure.warningsTitle', 'Advertencias')}
          </h3>
          <ul className="space-y-1">
            {readiness.warnings.map((w, i) => (
              <li
                key={i}
                className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/5 p-1.5 rounded"
              >
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Audience selector + summary */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Eye className="w-3 h-3 text-secondary-token" aria-hidden="true" />
          <span className="text-[10px] uppercase text-secondary-token">
            {t('closure.previewAudience', 'Vista previa por audiencia')}
          </span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as SummaryAudience)}
            data-testid="closure-audience-select"
            className="text-xs rounded border border-default-token bg-surface px-2 py-0.5"
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div
          className="rounded-lg bg-surface-elevated p-3"
          data-testid={`closure-summary-${audience}`}
        >
          <p className="text-xs text-secondary-token mb-2">{summary.narrative}</p>
          <ul className="grid grid-cols-2 gap-2">
            {summary.highlights.map((h, i) => (
              <li key={i} className="text-xs">
                <p className="text-[10px] uppercase opacity-70">{h.label}</p>
                <p className="font-bold">{h.value}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Confirm button */}
      {readiness.canClose && onConfirmClose && (
        <button
          type="button"
          onClick={onConfirmClose}
          data-testid="closure-confirm"
          className="w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-md bg-rose-500 text-white text-xs font-bold hover:bg-rose-600"
        >
          <FlagOff className="w-3 h-3" aria-hidden="true" />
          {t('closure.confirm', 'Confirmar cierre proyecto')}
        </button>
      )}
    </section>
  );
}
