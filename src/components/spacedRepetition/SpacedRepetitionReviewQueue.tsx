// Praeventio Guard — Wire UI #35: <SpacedRepetitionReviewQueue />
//
// Cola de cards de repetición espaciada pendientes hoy. El trabajador
// va calificando 0-5 y el algoritmo SM-2 actualiza intervalos.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ThumbsUp, ThumbsDown, RefreshCw } from 'lucide-react';
import {
  selectDueCards,
  reviewCard,
  type LearningCard,
} from '../../services/spacedRepetition/spacedRepetitionScheduler.js';

interface SpacedRepetitionReviewQueueProps {
  cards: LearningCard[];
  /** ISO-8601 "now" para selectDueCards. */
  now?: string;
  onUpdateCard?: (updated: LearningCard) => void;
}

export function SpacedRepetitionReviewQueue({
  cards,
  now = new Date().toISOString(),
  onUpdateCard,
}: SpacedRepetitionReviewQueueProps) {
  const { t } = useTranslation();
  const dueCards = useMemo(() => selectDueCards(cards, now), [cards, now]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  if (dueCards.length === 0) {
    return (
      <section
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center"
        data-testid="sr-queue-empty"
      >
        <Brain className="w-6 h-6 mx-auto mb-1 text-emerald-600" aria-hidden="true" />
        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
          {t('sr.allDone', 'Sin repasos pendientes')}
        </p>
        <p className="text-xs text-emerald-600 dark:text-emerald-400/80 mt-1">
          {t('sr.allDoneSubtitle', 'Vuelve mañana para nuevos repasos.')}
        </p>
      </section>
    );
  }

  const card = dueCards[Math.min(currentIdx, dueCards.length - 1)];

  function handleRate(quality: 0 | 3 | 5) {
    const updated = reviewCard(card, quality, new Date().toISOString());
    onUpdateCard?.(updated);
    setRevealed(false);
    setCurrentIdx((i) => Math.min(i + 1, dueCards.length));
  }

  if (currentIdx >= dueCards.length) {
    return (
      <section
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center"
        data-testid="sr-queue-complete"
      >
        <ThumbsUp className="w-6 h-6 mx-auto mb-1 text-emerald-600" aria-hidden="true" />
        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
          {t('sr.sessionComplete', '¡Sesión completada!')}
        </p>
        <p className="text-xs text-emerald-600 dark:text-emerald-400/80 mt-1">
          {dueCards.length} {t('sr.cardsReviewed', 'cards repasadas')}
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="sr-queue"
      aria-label={t('sr.aria', 'Cola repetición espaciada') as string}
    >
      <header className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('sr.title', 'Repaso programado')}
        </h2>
        <span className="ml-auto text-xs text-secondary-token tabular-nums">
          {currentIdx + 1} / {dueCards.length}
        </span>
      </header>

      <div className="rounded-lg bg-surface-elevated p-4">
        <p className="text-[10px] uppercase text-secondary-token mb-1">
          {t('sr.topicLabel', 'Tema')}
        </p>
        <h3 className="text-base font-bold text-primary-token" data-testid="sr-topic">
          {card.topic}
        </h3>
        <p className="text-[10px] text-secondary-token mt-2">
          {t('sr.reviewCount', 'Repaso #{n}', { n: card.reviewCount + 1 }).replace(
            '{n}',
            String(card.reviewCount + 1),
          )}{' '}
          · {t('sr.intervalLabel', 'Intervalo')}: {card.intervalDays}d
        </p>
      </div>

      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          data-testid="sr-reveal"
          className="w-full px-4 py-2 rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300 text-xs font-bold border border-sky-500/30 hover:bg-sky-500/20"
        >
          {t('sr.reveal', 'Mostrar pregunta')}
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2" data-testid="sr-rating-buttons">
          <button
            type="button"
            onClick={() => handleRate(0)}
            data-testid="sr-rate-fail"
            className="inline-flex flex-col items-center justify-center gap-0.5 p-3 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[11px] font-bold border border-rose-500/30 hover:bg-rose-500/20"
          >
            <ThumbsDown className="w-4 h-4" aria-hidden="true" />
            {t('sr.fail', 'No recordé')}
          </button>
          <button
            type="button"
            onClick={() => handleRate(3)}
            data-testid="sr-rate-medium"
            className="inline-flex flex-col items-center justify-center gap-0.5 p-3 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-bold border border-amber-500/40 hover:bg-amber-500/25"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {t('sr.medium', 'Con esfuerzo')}
          </button>
          <button
            type="button"
            onClick={() => handleRate(5)}
            data-testid="sr-rate-ok"
            className="inline-flex flex-col items-center justify-center gap-0.5 p-3 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold border border-emerald-500/40 hover:bg-emerald-500/25"
          >
            <ThumbsUp className="w-4 h-4" aria-hidden="true" />
            {t('sr.ok', 'Lo recordé')}
          </button>
        </div>
      )}
    </section>
  );
}
