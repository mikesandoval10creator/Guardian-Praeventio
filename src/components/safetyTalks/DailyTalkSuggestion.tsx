// Praeventio Guard — Wire UI #3: <DailyTalkSuggestion />
//
// Daily safety talk suggestion widget for supervisors. Consumes
// `suggestTalks(signals)` from `safetyTalks/talkTopicSuggester.ts` and
// shows top 3 with rationale chips, citing the triggers (no LLM).
//
// Used in: Site chief Dashboard, ProjectDetail sidebar.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Clock, Sparkles } from 'lucide-react';
import {
  suggestTalks,
  type ContextSignals,
  type SafetyTalkSuggestion,
} from '../../services/safetyTalks/talkTopicSuggester.js';

interface DailyTalkSuggestionProps {
  signals: ContextSignals;
  /** Max suggestions to show. Default 3. */
  limit?: number;
  onPick?: (suggestion: SafetyTalkSuggestion) => void;
}

export function DailyTalkSuggestion({ signals, limit = 3, onPick }: DailyTalkSuggestionProps) {
  const { t } = useTranslation();
  const suggestions = useMemo(() => suggestTalks(signals).slice(0, limit), [signals, limit]);

  if (suggestions.length === 0) {
    return (
      <div
        className="rounded-2xl border border-default-token bg-surface p-4 text-center text-secondary-token"
        data-testid="talk-suggestion-empty"
      >
        <Sparkles className="w-5 h-5 mx-auto mb-1 opacity-50" aria-hidden="true" />
        <p className="text-xs">
          {t('talk_suggestion.empty', 'No hay temas críticos hoy. Charla a elección del supervisor.')}
        </p>
      </div>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="daily-talk-suggestion"
      aria-label={t('talk_suggestion.aria', 'Sugerencia de charla diaria') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <MessageCircle className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('talk_suggestion.title', 'Charla sugerida hoy')}
        </h2>
      </header>

      <ul className="flex flex-col gap-3">
        {suggestions.map((s, idx) => (
          <li
            key={s.topicId}
            className={`rounded-lg border p-3 transition-colors ${
              idx === 0
                ? 'border-emerald-500/40 bg-emerald-500/5'
                : 'border-default-token bg-surface-elevated'
            }`}
            data-testid={`talk-suggestion-${s.topicId}`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-sm font-bold text-primary-token leading-tight">
                {s.title}
              </h3>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-token shrink-0">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {s.durationMinutes} min
              </span>
            </div>

            {s.rationale.length > 0 && (
              <ul className="flex flex-wrap gap-1 mb-2">
                {s.rationale.map((r) => (
                  <li
                    key={r}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-300"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            )}

            {onPick && (
              <button
                type="button"
                onClick={() => onPick(s)}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
                data-testid={`talk-suggestion-pick-${s.topicId}`}
              >
                {t('talk_suggestion.pick', 'Usar esta charla →')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
