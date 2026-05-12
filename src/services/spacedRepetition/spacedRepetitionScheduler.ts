// Praeventio Guard — Sprint K: Aprendizaje post-capacitación + Repetición Espaciada.
//
// Cierra: Documento usuario "§85-89"
//
// Después de un curso de seguridad, programar repasos espaciados para
// asegurar retención (algoritmo SM-2 simplificado):
//   - Día 1: repaso corto
//   - Día 7: repaso medio
//   - Día 30: evaluación
//   - Día 90: refresh
//
// Si el trabajador falla en evaluación, el intervalo se acorta. Si
// responde correctamente, se alarga.
//
// Determinístico. Sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface LearningCard {
  id: string;
  workerUid: string;
  /** Tema (ej: "altura R1", "químicos básico"). */
  topic: string;
  /** ISO-8601 del primer aprendizaje. */
  initiallyLearnedAt: string;
  /** Veces que se ha repasado. */
  reviewCount: number;
  /** Ease factor SM-2 (1.3 mínimo). */
  easeFactor: number;
  /** Días hasta el próximo repaso. */
  intervalDays: number;
  /** ISO-8601 del próximo repaso programado. */
  nextReviewAt: string;
  /** Última calificación 0-5. */
  lastQuality?: number;
}

// ────────────────────────────────────────────────────────────────────────
// SM-2 scheduling
// ────────────────────────────────────────────────────────────────────────

/**
 * Algoritmo SM-2 (SuperMemo-2) adaptado:
 *   - quality 0-2 → fallo: intervalo vuelve a 1 día
 *   - quality 3+ → éxito: intervalo *= easeFactor
 *   - easeFactor: ajustado por (0.1 - (5-quality)*(0.08 + (5-quality)*0.02))
 */
export function reviewCard(card: LearningCard, quality: 0 | 1 | 2 | 3 | 4 | 5, nowIso: string): LearningCard {
  let newEaseFactor = card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEaseFactor < 1.3) newEaseFactor = 1.3;

  let newInterval: number;
  if (quality < 3) {
    // Fallo: reiniciar
    newInterval = 1;
  } else {
    if (card.reviewCount === 0) newInterval = 1;
    else if (card.reviewCount === 1) newInterval = 6;
    else newInterval = Math.round(card.intervalDays * newEaseFactor);
  }

  return {
    ...card,
    reviewCount: card.reviewCount + 1,
    easeFactor: Math.round(newEaseFactor * 100) / 100,
    intervalDays: newInterval,
    nextReviewAt: new Date(Date.parse(nowIso) + newInterval * 86_400_000).toISOString(),
    lastQuality: quality,
  };
}

export function createInitialCard(
  cardId: string,
  workerUid: string,
  topic: string,
  initiallyLearnedAt: string,
): LearningCard {
  return {
    id: cardId,
    workerUid,
    topic,
    initiallyLearnedAt,
    reviewCount: 0,
    easeFactor: 2.5,
    intervalDays: 1,
    nextReviewAt: new Date(Date.parse(initiallyLearnedAt) + 86_400_000).toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Due cards selector
// ────────────────────────────────────────────────────────────────────────

export function selectDueCards(cards: LearningCard[], nowIso: string): LearningCard[] {
  const nowMs = Date.parse(nowIso);
  return cards
    .filter((c) => Date.parse(c.nextReviewAt) <= nowMs)
    .sort((a, b) => Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));
}

// ────────────────────────────────────────────────────────────────────────
// Worker retention report
// ────────────────────────────────────────────────────────────────────────

export interface RetentionReport {
  workerUid: string;
  totalCards: number;
  /** % de cards en intervalo > 30d (consolidadas). */
  consolidatedPercent: number;
  /** Topics con mayor riesgo de olvido (intervalo <= 7d). */
  weakTopics: string[];
  /** Días promedio entre repasos. */
  averageIntervalDays: number;
}

export function buildRetentionReport(cards: LearningCard[], workerUid: string): RetentionReport {
  const own = cards.filter((c) => c.workerUid === workerUid);
  if (own.length === 0) {
    return {
      workerUid,
      totalCards: 0,
      consolidatedPercent: 0,
      weakTopics: [],
      averageIntervalDays: 0,
    };
  }
  const consolidated = own.filter((c) => c.intervalDays > 30);
  const weak = own.filter((c) => c.intervalDays <= 7);
  const avg = Math.round(own.reduce((s, c) => s + c.intervalDays, 0) / own.length);
  return {
    workerUid,
    totalCards: own.length,
    consolidatedPercent: Math.round((consolidated.length / own.length) * 100),
    weakTopics: [...new Set(weak.map((c) => c.topic))],
    averageIntervalDays: avg,
  };
}
