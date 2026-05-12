// Praeventio Guard — Wire UI #72: <CalmRecommendationCard />
//
// Renderiza una recomendación calma derivada de fuente externa (EONET
// USGS) sin mencionar el organismo en el copy principal. El detalle
// técnico va en expandable opt-in.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, AlertCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type {
  CalmRecommendation,
  RecommendationSeverity,
} from '../../services/external/recommendationBuilder.js';

interface CalmRecommendationCardProps {
  recommendation: CalmRecommendation;
}

const TONE: Record<RecommendationSeverity, { Icon: typeof Info; color: string; bg: string }> = {
  info: { Icon: Info, color: 'text-sky-500', bg: 'bg-sky-500/10' },
  caution: { Icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  high: { Icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-500/10' },
};

export function CalmRecommendationCard({ recommendation }: CalmRecommendationCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const tone = TONE[recommendation.severity];
  const { Icon } = tone;

  return (
    <section
      className={`rounded-2xl border border-default-token p-4 shadow-mode space-y-3 ${tone.bg}`}
      data-testid={`calm-rec-${recommendation.citation.refId}`}
      aria-label={t('calmRec.aria', 'Recomendación calma') as string}
    >
      <header className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token">{recommendation.title}</h2>
        <span
          className={`ml-auto text-[10px] uppercase font-bold ${tone.color}`}
          data-testid={`calm-rec-severity-${recommendation.citation.refId}`}
        >
          {recommendation.severity}
        </span>
      </header>

      <p className="text-xs text-secondary-token" data-testid={`calm-rec-body-${recommendation.citation.refId}`}>
        {recommendation.body}
      </p>

      {recommendation.actions.length > 0 && (
        <ul
          className="space-y-1"
          data-testid={`calm-rec-actions-${recommendation.citation.refId}`}
        >
          {recommendation.actions.map((a, i) => (
            <li
              key={i}
              className="text-[11px] bg-surface rounded px-2 py-1"
              data-testid={`calm-rec-action-${recommendation.citation.refId}-${i}`}
            >
              → {a.label}
            </li>
          ))}
        </ul>
      )}

      {recommendation.expandableDetail && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            data-testid={`calm-rec-toggle-${recommendation.citation.refId}`}
            className="flex items-center gap-1 text-[10px] uppercase font-bold text-secondary-token"
          >
            {expanded ? (
              <ChevronUp className="w-3 h-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            )}
            {expanded
              ? t('calmRec.hideDetail', 'Ocultar detalle técnico')
              : t('calmRec.showDetail', 'Detalle técnico (auditoría)')}
          </button>
          {expanded && (
            <p
              className="mt-1 text-[10px] text-secondary-token font-mono bg-surface rounded p-2"
              data-testid={`calm-rec-detail-${recommendation.citation.refId}`}
            >
              {recommendation.expandableDetail}
            </p>
          )}
        </div>
      )}

      <p
        className="text-[9px] uppercase text-secondary-token"
        data-testid={`calm-rec-citation-${recommendation.citation.refId}`}
      >
        Ref: {recommendation.citation.source} · {recommendation.citation.refId}
      </p>
    </section>
  );
}
