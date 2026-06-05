// Praeventio Guard — Wire UI #4a: <TopRisksWidget />
//
// Sidebar widget showing the Top N risks of the current project, ranked by
// their DS44 IPER score (probabilidad × severidad). B2 🔵 (Fase 5): the input
// is now `RankedRiskNode[]` already ranked + classified server-side by the
// canonical IPER engine (`riskNodeRanking`, ADR 0020) — the widget no longer
// re-ranks by ad-hoc counters (which showed "(0 trab.)" for Zettelkasten
// risks). Pure presentational: ranked-list-in, list-out.

import { useTranslation } from 'react-i18next';
import { Flame, ArrowUpRight } from 'lucide-react';
import type { RankedRiskNode } from '../../services/riskRanking/riskNodeRanking.js';
import type { IperCriticidad } from '../../services/protocols/iperCriticidad.js';

interface TopRisksWidgetProps {
  risks: RankedRiskNode[];
  topN?: number;
  onRiskClick?: (riskId: string) => void;
}

const CRITICIDAD_DOT: Record<IperCriticidad, string> = {
  Crítica: 'bg-rose-500',
  Alta: 'bg-orange-500',
  Media: 'bg-amber-500',
  Baja: 'bg-emerald-500',
};

export function TopRisksWidget({ risks, topN = 5, onRiskClick }: TopRisksWidgetProps) {
  const { t } = useTranslation();
  // Server already ranked by IPER score; just bound to topN defensively.
  const ranked = risks.slice(0, topN);

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
                className={`w-2 h-2 rounded-full shrink-0 ${CRITICIDAD_DOT[r.criticidad]}`}
                aria-label={r.criticidad}
              />
              <button
                type="button"
                onClick={() => onRiskClick?.(r.id)}
                disabled={!onRiskClick}
                className="flex-1 min-w-0 text-left text-xs text-primary-token hover:underline disabled:no-underline disabled:cursor-default truncate"
                title={r.title}
              >
                <span className="font-semibold">{r.title}</span>
                <span className="text-muted-token ml-1">({r.category})</span>
              </button>
              <span
                className="text-[10px] font-bold text-rose-600 dark:text-rose-400 tabular-nums"
                title={`IPER ${r.iperLevel} — P${r.probabilidad}×S${r.severidad}`}
              >
                {r.iperScore}
              </span>
              {onRiskClick && <ArrowUpRight className="w-3 h-3 text-muted-token" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
