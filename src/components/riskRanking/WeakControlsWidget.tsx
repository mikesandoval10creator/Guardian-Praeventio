// Praeventio Guard — Wire UI #4b: <WeakControlsWidget />
//
// Sidebar widget showing controls with high failure rate or no recent
// verification. B2 🔵 (Fase 5): input is now `ControlWeakness[]` already
// ranked server-side from the terreno validation log (controlValidationAggregation,
// ADR 0020). The widget no longer re-ranks via ad-hoc ControlRecord counters.
//
// Used in: Risks page (paired with <TopRisksDashboardCard />).

import { useTranslation } from 'react-i18next';
import { ShieldAlert, Clock } from 'lucide-react';
import type { ControlWeakness } from '../../services/riskRanking/riskRankingEngine.js';

interface WeakControlsWidgetProps {
  controls: ControlWeakness[];
  topN?: number;
  onControlClick?: (controlId: string) => void;
}

export function WeakControlsWidget({ controls, topN = 5, onControlClick }: WeakControlsWidgetProps) {
  const { t } = useTranslation();
  // Server already ranked by weakness score; bound to topN defensively.
  const ranked = controls.slice(0, topN);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="weak-controls-widget"
      aria-label={t('weak_controls.aria', 'Controles débiles') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('weak_controls.title', 'Controles débiles')}
        </h2>
      </header>

      {ranked.length === 0 ? (
        <p className="text-xs text-secondary-token italic">
          {t('weak_controls.empty', 'Sin controles rankeables todavía.')}
        </p>
      ) : (
        <ol className="space-y-2">
          {ranked.map((c, idx) => (
            <li
              key={c.controlId}
              className="flex items-center gap-2"
              data-testid={`weak-control-${c.controlId}`}
            >
              <span className="text-xs font-bold w-4 text-muted-token tabular-nums">
                {idx + 1}.
              </span>
              <button
                type="button"
                onClick={() => onControlClick?.(c.controlId)}
                disabled={!onControlClick}
                className="flex-1 min-w-0 text-left text-xs text-primary-token hover:underline disabled:no-underline disabled:cursor-default truncate"
                title={c.label}
              >
                {c.label}
              </button>
              {c.isOverdueVerification && (
                <Clock
                  className="w-3 h-3 text-rose-500 shrink-0"
                  aria-label={t('weak_controls.overdue', 'Verificación vencida') as string}
                />
              )}
              <span
                className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300"
                title={t('weak_controls.failure_rate', 'Tasa de falla') as string}
              >
                {Math.round(c.failureRate * 100)}%
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
