// Praeventio Guard — Sprint 51 §83-87: Aprendizaje post-capacitación +
// repetición espaciada (parcial) + casos reales (matching).
//
// Cierra §83 (assessment post-capacitación), §84 (delay matrix por
// dificultad), §85 (refuerzo por tema con repetición espaciada — combina
// con spacedRepetitionScheduler existente), §86 (banco de preguntas),
// §87 (case study match — sugiere caso real del Zettelkasten relevante
// al training).
//
// 100% determinístico. No invoca LLMs. Toma snapshots + tabla preguntas
// + scheduler + nodos ZK → produce assessment plan + score + refuerzo.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface AssessmentQuestion {
  id: string;
  topic: string;
  difficulty: Difficulty;
  /** Pregunta canónica (markdown OK). */
  prompt: string;
  /** Opciones (multiple choice). */
  options: Array<{ id: string; label: string; isCorrect: boolean; rationale?: string }>;
  /** Si la respuesta correcta es vital (gating safety) y no puede salir mal. */
  safetyCritical?: boolean;
}

export interface AssessmentAttempt {
  questionId: string;
  selectedOptionId: string;
  /** Tiempo en segundos que tardó. */
  durationSeconds: number;
  attemptAt: string;
}

export interface AssessmentResult {
  workerUid: string;
  trainingId: string;
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  scorePercent: number;
  /** Si pasó el threshold (default 80% + 100% en safety_critical). */
  passed: boolean;
  /** Preguntas que falló (para refuerzo dirigido). */
  failedQuestionIds: string[];
  /** Topics que requieren refuerzo. */
  topicsForReinforcement: string[];
  /** Tiempo total. */
  totalSeconds: number;
}

export interface ScoreOptions {
  passingScorePercent?: number;
  /** Si un safety_critical fallido debe forzar reprobación. */
  enforceCriticalGate?: boolean;
}

export function scoreAssessment(
  workerUid: string,
  trainingId: string,
  questions: ReadonlyArray<AssessmentQuestion>,
  attempts: ReadonlyArray<AssessmentAttempt>,
  options: ScoreOptions = {},
): AssessmentResult {
  const passingScore = options.passingScorePercent ?? 80;
  const enforceCritical = options.enforceCriticalGate ?? true;

  const byId = new Map(questions.map((q) => [q.id, q] as const));
  let correct = 0;
  let incorrect = 0;
  let totalSeconds = 0;
  const failed: string[] = [];
  const failedTopics = new Set<string>();
  let criticalFailed = false;

  for (const attempt of attempts) {
    const q = byId.get(attempt.questionId);
    if (!q) continue;
    totalSeconds += attempt.durationSeconds;
    const opt = q.options.find((o) => o.id === attempt.selectedOptionId);
    if (opt?.isCorrect) {
      correct += 1;
    } else {
      incorrect += 1;
      failed.push(q.id);
      failedTopics.add(q.topic);
      if (q.safetyCritical) criticalFailed = true;
    }
  }

  const scorePercent = questions.length === 0 ? 0 : Math.round((correct / questions.length) * 100);
  const passed =
    scorePercent >= passingScore && (!enforceCritical || !criticalFailed);

  return {
    workerUid,
    trainingId,
    totalQuestions: questions.length,
    correctCount: correct,
    incorrectCount: incorrect,
    scorePercent,
    passed,
    failedQuestionIds: failed,
    topicsForReinforcement: Array.from(failedTopics),
    totalSeconds,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Spaced repetition delay matrix (§84)
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns el próximo intervalo (días) para preguntar nuevamente sobre
 * un topic dado el nivel de dificultad + cuántas veces se ha acertado
 * seguido. Ebbinghaus-inspired matrix.
 */
export function nextReviewDelayDays(
  difficulty: Difficulty,
  consecutiveCorrect: number,
): number {
  // Base intervals
  const base: Record<Difficulty, number> = {
    easy: 7,
    medium: 4,
    hard: 2,
    expert: 1,
  };
  const baseDays = base[difficulty];
  // Cada acierto consecutivo dobla (cap a 90d)
  const multiplier = Math.min(8, Math.pow(2, consecutiveCorrect));
  return Math.min(90, baseDays * multiplier);
}

export interface ReviewScheduleItem {
  topic: string;
  difficulty: Difficulty;
  consecutiveCorrect: number;
  nextReviewAt: string;
}

export function scheduleNextReviews(
  workerUid: string,
  topicHistory: ReadonlyArray<{ topic: string; difficulty: Difficulty; consecutiveCorrect: number }>,
  options: { now: Date },
): ReviewScheduleItem[] {
  const nowMs = options.now.getTime();
  return topicHistory.map((h) => {
    const days = nextReviewDelayDays(h.difficulty, h.consecutiveCorrect);
    const nextMs = nowMs + days * 86_400_000;
    return {
      topic: h.topic,
      difficulty: h.difficulty,
      consecutiveCorrect: h.consecutiveCorrect,
      nextReviewAt: new Date(nextMs).toISOString(),
    };
  });
}

// ────────────────────────────────────────────────────────────────────────
// Case study matcher (§87) — sugiere caso real del Zettelkasten relevante
// ────────────────────────────────────────────────────────────────────────

export interface CaseStudyNode {
  nodeId: string;
  title: string;
  kind: 'incident' | 'near_miss' | 'good_practice' | 'lesson_learned';
  topics: string[];
  severity?: 'low' | 'medium' | 'high' | 'critical' | 'sif';
  /** Industry para filtrado. */
  industry?: string;
  /** Cuándo ocurrió. */
  occurredAt: string;
}

export interface CaseStudyMatch {
  node: CaseStudyNode;
  /** Score 0-100 de relevancia. */
  relevanceScore: number;
  /** Razones humanas. */
  reasons: string[];
}

export interface MatchOptions {
  /** Industry del worker para filtrar. */
  industry?: string;
  /** Máximo casos a sugerir. */
  maxResults?: number;
  /** Preferir incidentes severos (didáctico). */
  preferSevere?: boolean;
}

export function findRelevantCaseStudies(
  topicsOfInterest: ReadonlyArray<string>,
  nodes: ReadonlyArray<CaseStudyNode>,
  options: MatchOptions = {},
): CaseStudyMatch[] {
  const maxResults = options.maxResults ?? 3;
  const preferSevere = options.preferSevere ?? true;
  const topicsSet = new Set(topicsOfInterest.map((t) => t.toLowerCase()));

  const matches: CaseStudyMatch[] = [];
  for (const node of nodes) {
    if (options.industry && node.industry && node.industry !== options.industry) continue;

    let score = 0;
    const reasons: string[] = [];

    const overlap = node.topics.filter((t) => topicsSet.has(t.toLowerCase()));
    if (overlap.length === 0) continue;
    score += overlap.length * 25;
    reasons.push(`${overlap.length} tópico(s) coinciden: ${overlap.join(', ')}`);

    if (preferSevere && node.severity) {
      const sevBoost = {
        low: 0,
        medium: 5,
        high: 10,
        critical: 15,
        sif: 20,
      }[node.severity];
      score += sevBoost;
      if (sevBoost > 0) reasons.push(`Severidad ${node.severity} (+${sevBoost})`);
    }

    // Incidentes y lessons_learned son más didácticos que good_practices
    if (node.kind === 'incident' || node.kind === 'lesson_learned') {
      score += 10;
      reasons.push('Tipo didáctico (incident/lesson_learned)');
    }

    // Recencia: ≤365d = +5, ≤90d = +10
    const ageMs = Date.now() - Date.parse(node.occurredAt);
    const ageDays = ageMs / 86_400_000;
    if (ageDays < 90) {
      score += 10;
      reasons.push('Caso reciente (<90 días)');
    } else if (ageDays < 365) {
      score += 5;
    }

    matches.push({
      node,
      relevanceScore: Math.min(100, score),
      reasons,
    });
  }

  return matches.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, maxResults);
}
