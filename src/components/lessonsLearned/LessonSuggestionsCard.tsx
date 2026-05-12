// Praeventio Guard — Wire UI #17: <LessonSuggestionsCard />
//
// Cuando se prepara una tarea, sugerir lecciones aprendidas relevantes
// con relevance score y matchReasons.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ArrowUpRight } from 'lucide-react';
import {
  suggestLessonsForTask,
  type Lesson,
  type TaskContext,
} from '../../services/lessonsLearned/lessonsLibrary.js';

interface LessonSuggestionsCardProps {
  library: Lesson[];
  context: TaskContext;
  topN?: number;
  onLessonClick?: (lessonId: string) => void;
}

export function LessonSuggestionsCard({
  library,
  context,
  topN = 3,
  onLessonClick,
}: LessonSuggestionsCardProps) {
  const { t } = useTranslation();
  const suggestions = useMemo(
    () => suggestLessonsForTask(library, context, topN),
    [library, context, topN],
  );

  if (suggestions.length === 0) {
    return (
      <article
        className="rounded-2xl border border-default-token bg-surface p-4 text-center text-secondary-token"
        data-testid="lesson-suggestions-empty"
      >
        <BookOpen className="w-5 h-5 mx-auto mb-1 opacity-50" aria-hidden="true" />
        <p className="text-xs">
          {t('lessons.empty', 'Sin lecciones relevantes en la biblioteca para este contexto.')}
        </p>
      </article>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="lesson-suggestions-card"
      aria-label={t('lessons.aria', 'Lecciones aprendidas relevantes') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <BookOpen className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('lessons.title', 'Lecciones aprendidas relevantes')}
        </h2>
      </header>

      <ul className="space-y-3">
        {suggestions.map((s) => (
          <li
            key={s.id}
            data-testid={`lesson-${s.id}`}
            className="rounded-lg border border-default-token bg-surface-elevated p-3"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-xs font-bold text-primary-token leading-tight">
                {s.summary}
              </h3>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0">
                {s.relevance}%
              </span>
            </div>
            <p className="text-[11px] text-secondary-token mb-1.5 leading-snug">
              ↳ {s.preventiveAction}
            </p>
            {s.matchReasons.length > 0 && (
              <ul className="flex flex-wrap gap-1 mb-1.5">
                {s.matchReasons.map((r) => (
                  <li
                    key={r}
                    className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            )}
            {onLessonClick && (
              <button
                type="button"
                onClick={() => onLessonClick(s.id)}
                data-testid={`lesson-open-${s.id}`}
                className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-1"
              >
                {t('lessons.openFull', 'Ver completa')} <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
