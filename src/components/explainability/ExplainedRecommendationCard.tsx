// Praeventio Guard — Wire UI F.28: <ExplainedRecommendationCard />
//
// Reusable card that renders an ExplainedRecommendation with:
//   • action (header)
//   • responsible role + validity badges
//   • confidence chip (high / medium / low)
//   • % LLM inference share if > 0
//   • evidence list with deterministic-vs-LLM glyph
//   • citation footer
//
// Caller passes the explained recommendation (already produced by the
// /explainability route or computed client-side from the engine).

import { ShieldCheck, Bot, Sparkles } from 'lucide-react';
import type {
  ExplainedRecommendation,
  RecommendationConfidence,
} from '../../services/explainability/recommendationExplainer';

interface ExplainedRecommendationCardProps {
  explained: ExplainedRecommendation;
}

const CONFIDENCE_META: Record<
  RecommendationConfidence,
  { label: string; classes: string }
> = {
  high: {
    label: 'Alta',
    classes:
      'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
  },
  medium: {
    label: 'Media',
    classes:
      'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
  },
  low: {
    label: 'Baja',
    classes:
      'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
  },
};

export function ExplainedRecommendationCard({
  explained,
}: ExplainedRecommendationCardProps) {
  const { recommendation, whyEvidences, confidence, citations } = explained;
  const conf = CONFIDENCE_META[confidence];
  const llmPct = Math.round(explained.llmInferenceShare * 100);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
      data-testid="explainability.card"
      aria-label="Recomendación explicada"
    >
      <header className="flex items-start gap-2">
        <Sparkles
          className="w-4 h-4 mt-1 text-indigo-500"
          aria-hidden="true"
        />
        <div className="flex-1">
          <h3
            className="text-sm font-bold text-primary-token"
            data-testid="explainability.card.action"
          >
            {recommendation.action}
          </h3>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
            {recommendation.responsibleRole && (
              <span
                className="rounded bg-white/60 dark:bg-white/10 px-2 py-0.5"
                data-testid="explainability.card.responsibleRole"
              >
                Responsable: {recommendation.responsibleRole}
              </span>
            )}
            {recommendation.validUntil && (
              <span
                className="rounded bg-white/60 dark:bg-white/10 px-2 py-0.5"
                data-testid="explainability.card.validUntil"
              >
                Hasta: {recommendation.validUntil}
              </span>
            )}
            <span
              className={`rounded px-2 py-0.5 border ${conf.classes}`}
              data-testid="explainability.card.confidence"
            >
              {conf.label}
            </span>
            {llmPct > 0 && (
              <span
                className="rounded bg-purple-500/10 border border-purple-500/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 inline-flex items-center gap-1"
                data-testid="explainability.card.llmShare"
              >
                <Bot className="w-3 h-3" aria-hidden="true" />
                {llmPct}% IA
              </span>
            )}
            {explained.isFullyDeterministic && (
              <span
                className="rounded bg-teal-500/10 border border-teal-500/30 text-teal-700 dark:text-teal-300 px-2 py-0.5 inline-flex items-center gap-1"
                data-testid="explainability.card.deterministic"
              >
                <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                100% determinista
              </span>
            )}
          </div>
        </div>
      </header>

      {whyEvidences.length > 0 && (
        <ul
          className="space-y-1 text-[12px] text-secondary-token"
          data-testid="explainability.card.evidenceList"
        >
          {whyEvidences.map((e) => {
            const isLlm = e.kind === 'llm_inference';
            return (
              <li
                key={e.id}
                className="flex items-start gap-2"
                data-testid={`explainability.card.evidence.${e.kind}`}
              >
                <span
                  className={isLlm ? 'text-purple-500' : 'text-teal-500'}
                  aria-hidden="true"
                >
                  {isLlm ? '🤖' : '✓'}
                </span>
                <span className="flex-1">
                  {e.description}{' '}
                  <span className="text-[10px] font-mono text-primary-token/70">
                    {e.citation}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {citations.length > 0 && (
        <footer
          className="border-t border-default-token pt-2 text-[10px] font-mono text-secondary-token"
          data-testid="explainability.card.citationsFooter"
        >
          Fuentes: {citations.join(' · ')}
        </footer>
      )}
    </section>
  );
}
